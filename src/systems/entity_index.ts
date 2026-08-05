import { W, EntityType, type Entity } from '../core/types';

export const ENTITY_MASK_NPC = 1 << EntityType.NPC;
export const ENTITY_MASK_MONSTER = 1 << EntityType.MONSTER;
export const ENTITY_MASK_ITEM_DROP = 1 << EntityType.ITEM_DROP;
export const ENTITY_MASK_PROJECTILE = 1 << EntityType.PROJECTILE;
export const ENTITY_MASK_BILLBOARD = 1 << EntityType.BILLBOARD;
export const ENTITY_MASK_ACTOR = ENTITY_MASK_NPC | ENTITY_MASK_MONSTER;
export const ENTITY_MASK_VISIBLE = ENTITY_MASK_ACTOR | ENTITY_MASK_ITEM_DROP | ENTITY_MASK_PROJECTILE | ENTITY_MASK_BILLBOARD;
const ENTITY_MASK_STATIC_VISIBLE = ENTITY_MASK_ITEM_DROP | ENTITY_MASK_BILLBOARD;

const BUCKET_SIZE = 16;
const BUCKET_HALF_SIZE = BUCKET_SIZE * 0.5;
const BUCKET_SHIFT = 4;
const BUCKETS_PER_AXIS = W >> BUCKET_SHIFT;
const BUCKET_COUNT = BUCKETS_PER_AXIS * BUCKETS_PER_AXIS;
const BUCKET_PLANE_COUNT = BUCKET_COUNT * 2;
const BUCKET_MASK = BUCKETS_PER_AXIS - 1;
const PATH_BUCKET_STEP = BUCKET_SIZE * 0.5;

export type EntityIndexRebuildReason =
  | 'manual'
  | 'load'
  | 'simulation'
  | 'spawn_cleanup'
  | 'smoke_stress'
  | 'marketing_hell_eyes'
  | 'ensure';

export interface EntityIndexBucketStats {
  bucketCount: number;
  usedBucketCount: number;
  maxBucketSize: number;
  meanUsedBucketSize: number;
}

export interface EntityIndexQueryStats {
  radiusCount: number;
  pathCount: number;
  bucketChecks: number;
  resultCount: number;
  maxResultCount: number;
  visibleCount: number;
  visibleResultCount: number;
  lastVisibleResultCount: number;
}

export interface EntityIndexDebugStats {
  version: number;
  rebuildReason: EntityIndexRebuildReason;
  simulationFrame: number;
  entityCount: number;
  liveEntityCount: number;
  actorCount: number;
  aiCount: number;
  needsCount: number;
  projectileCount: number;
  npcCount: number;
  monsterCount: number;
  itemCount: number;
  rebuildMs: number;
  buckets: EntityIndexBucketStats;
  queries: EntityIndexQueryStats;
}

function entityMask(e: Entity): number {
  return 1 << e.type;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function emptyDebugStats(): EntityIndexDebugStats {
  return {
    version: 0,
    rebuildReason: 'manual',
    simulationFrame: -1,
    entityCount: 0,
    liveEntityCount: 0,
    actorCount: 0,
    aiCount: 0,
    needsCount: 0,
    projectileCount: 0,
    npcCount: 0,
    monsterCount: 0,
    itemCount: 0,
    rebuildMs: 0,
    buckets: {
      bucketCount: BUCKET_PLANE_COUNT,
      usedBucketCount: 0,
      maxBucketSize: 0,
      meanUsedBucketSize: 0,
    },
    queries: {
      radiusCount: 0,
      pathCount: 0,
      bucketChecks: 0,
      resultCount: 0,
      maxResultCount: 0,
      visibleCount: 0,
      visibleResultCount: 0,
      lastVisibleResultCount: 0,
    },
  };
}

function wrappedDelta(from: number, to: number): number {
  return ((to - from + W / 2) % W + W) % W - W / 2;
}

function wrappedBucketCoord(v: number): number {
  return (Math.floor(v) & (W - 1)) >> BUCKET_SHIFT;
}

function bucketAxisMinDistance(v: number, bucketCoord: number): number {
  const center = bucketCoord * BUCKET_SIZE + BUCKET_HALF_SIZE;
  const d = Math.abs(wrappedDelta(v, center));
  return d > BUCKET_HALF_SIZE ? d - BUCKET_HALF_SIZE : 0;
}

function bucketMinDistanceSq(x: number, y: number, bx: number, by: number): number {
  const dx = bucketAxisMinDistance(x, bx);
  const dy = bucketAxisMinDistance(y, by);
  return dx * dx + dy * dy;
}

export class EntityIndex {
  private readonly buckets: Entity[][];
  private readonly npcBuckets: Entity[][];
  private readonly monsterBuckets: Entity[][];
  private readonly staticBuckets: Entity[][];
  private readonly dynamicEntities: Entity[] = [];
  private readonly usedDynamicBucketIndices: number[] = [];
  private readonly staticIndexedIds = new Set<number>();
  private readonly bucketVisits = new Uint32Array(BUCKET_COUNT);
  private bucketVisitId = 1;
  readonly byId = new Map<number, Entity>();
  private readonly entityOrder = new Map<number, number>();
  readonly ai: Entity[] = [];
  readonly actors: Entity[] = [];
  readonly needs: Entity[] = [];
  readonly projectiles: Entity[] = [];
  private builtFor: readonly Entity[] | null = null;
  private builtEntityCount = -1;
  private dirty = true;
  private version = 0;
  private simulationFrame = -1;
  private debugStats = emptyDebugStats();
  private staticUsedBucketCount = 0;
  private staticMaxBucketSize = 0;

  constructor() {
    this.buckets = Array.from({ length: BUCKET_COUNT }, () => []);
    this.npcBuckets = Array.from({ length: BUCKET_COUNT }, () => []);
    this.monsterBuckets = Array.from({ length: BUCKET_COUNT }, () => []);
    this.staticBuckets = Array.from({ length: BUCKET_COUNT }, () => []);
  }

  beginTelemetryFrame(): void {
    const q = this.debugStats.queries;
    q.radiusCount = 0;
    q.pathCount = 0;
    q.bucketChecks = 0;
    q.resultCount = 0;
    q.maxResultCount = 0;
    q.visibleCount = 0;
    q.visibleResultCount = 0;
    q.lastVisibleResultCount = 0;
  }

  rebuild(
    entities: readonly Entity[],
    rebuildReason: EntityIndexRebuildReason = 'manual',
    simulationFrame = -1,
  ): void {
    const startedAt = nowMs();
    this.clearDynamicBuckets();
    for (let i = 0; i < BUCKET_COUNT; i++) this.staticBuckets[i].length = 0;
    this.dynamicEntities.length = 0;
    this.staticIndexedIds.clear();
    this.byId.clear();
    this.entityOrder.clear();
    this.ai.length = 0;
    this.actors.length = 0;
    this.needs.length = 0;
    this.projectiles.length = 0;

    let liveEntityCount = 0;
    let usedBucketCount = 0;
    let maxBucketSize = 0;
    let npcCount = 0;
    let monsterCount = 0;
    let itemCount = 0;

    for (let order = 0; order < entities.length; order++) {
      const e = entities[order];
      if (!e || !e.alive) continue;
      liveEntityCount++;
      this.byId.set(e.id, e);
      this.entityOrder.set(e.id, order);
      if (e.type === EntityType.NPC || e.type === EntityType.MONSTER) this.actors.push(e);
      if (e.type === EntityType.NPC) npcCount++;
      else if (e.type === EntityType.MONSTER) monsterCount++;
      else if (e.type === EntityType.ITEM_DROP) itemCount++;
      if (e.needs) this.needs.push(e);
      if (e.ai && (e.type === EntityType.NPC || e.type === EntityType.MONSTER)) this.ai.push(e);
      if (e.type === EntityType.PROJECTILE) this.projectiles.push(e);
      const staticVisible = (entityMask(e) & ENTITY_MASK_STATIC_VISIBLE) !== 0;
      const bucketIndex = wrappedBucketCoord(e.y) * BUCKETS_PER_AXIS + wrappedBucketCoord(e.x);
      const bucket = staticVisible ? this.staticBuckets[bucketIndex] : this.buckets[bucketIndex];
      if (bucket.length === 0) usedBucketCount++;
      if (staticVisible) {
        bucket.push(e);
        this.staticIndexedIds.add(e.id);
      } else {
        this.addDynamicEntityToBuckets(e, bucketIndex);
        this.dynamicEntities.push(e);
      }
      if (bucket.length > maxBucketSize) maxBucketSize = bucket.length;
    }

    this.builtFor = entities;
    this.builtEntityCount = entities.length;
    this.dirty = false;
    this.version++;
    this.simulationFrame = simulationFrame;
    this.recomputeStaticBucketStats();
    this.debugStats = {
      version: this.version,
      rebuildReason,
      simulationFrame,
      entityCount: entities.length,
      liveEntityCount,
      actorCount: this.actors.length,
      aiCount: this.ai.length,
      needsCount: this.needs.length,
      projectileCount: this.projectiles.length,
      npcCount,
      monsterCount,
      itemCount,
      rebuildMs: nowMs() - startedAt,
      buckets: {
        bucketCount: BUCKET_PLANE_COUNT,
        usedBucketCount,
        maxBucketSize,
        meanUsedBucketSize: usedBucketCount > 0 ? liveEntityCount / usedBucketCount : 0,
      },
      queries: this.debugStats.queries,
    };
  }

  private rebuildDynamicForSimulation(entities: readonly Entity[], simulationFrame: number): void {
    const startedAt = nowMs();
    this.clearDynamicBuckets();
    this.byId.clear();
    this.entityOrder.clear();
    this.ai.length = 0;
    this.actors.length = 0;
    this.needs.length = 0;
    this.projectiles.length = 0;
    this.addEntityTailToCachedBuckets(entities);
    const staticStats = this.reindexStaticEntities();

    let liveDynamicEntityCount = 0;
    let dynamicUsedBucketCount = 0;
    let dynamicMaxBucketSize = 0;
    let dynamicBucketedCount = 0;
    let npcCount = 0;
    let monsterCount = 0;
    const itemCount = staticStats.itemCount;

    for (let dynamicOrder = 0; dynamicOrder < this.dynamicEntities.length; dynamicOrder++) {
      const e = this.dynamicEntities[dynamicOrder];
      if (!e || !e.alive) {
        if (e) {
          this.byId.delete(e.id);
          this.entityOrder.delete(e.id);
        }
        continue;
      }
      liveDynamicEntityCount++;
      this.byId.set(e.id, e);
      this.entityOrder.set(e.id, dynamicOrder);
      if (e.type === EntityType.NPC || e.type === EntityType.MONSTER) this.actors.push(e);
      if (e.type === EntityType.NPC) npcCount++;
      else if (e.type === EntityType.MONSTER) monsterCount++;
      if (e.needs) this.needs.push(e);
      if (e.ai && (e.type === EntityType.NPC || e.type === EntityType.MONSTER)) this.ai.push(e);
      if (e.type === EntityType.PROJECTILE) this.projectiles.push(e);

      const bucketIndex = wrappedBucketCoord(e.y) * BUCKETS_PER_AXIS + wrappedBucketCoord(e.x);
      const bucket = this.buckets[bucketIndex];
      if (bucket.length === 0) dynamicUsedBucketCount++;
      this.addDynamicEntityToBuckets(e, bucketIndex);
      dynamicBucketedCount++;
      if (bucket.length > dynamicMaxBucketSize) dynamicMaxBucketSize = bucket.length;
    }

    this.builtEntityCount = entities.length;
    this.version++;
    this.simulationFrame = simulationFrame;
    const usedBucketCount = dynamicUsedBucketCount + this.staticUsedBucketCount;
    const bucketedCount = dynamicBucketedCount + staticStats.liveCount;
    this.debugStats = {
      version: this.version,
      rebuildReason: 'simulation',
      simulationFrame,
      entityCount: entities.length,
      liveEntityCount: liveDynamicEntityCount + staticStats.liveCount,
      actorCount: this.actors.length,
      aiCount: this.ai.length,
      needsCount: this.needs.length,
      projectileCount: this.projectiles.length,
      npcCount,
      monsterCount,
      itemCount,
      rebuildMs: nowMs() - startedAt,
      buckets: {
        bucketCount: BUCKET_PLANE_COUNT,
        usedBucketCount,
        maxBucketSize: Math.max(dynamicMaxBucketSize, this.staticMaxBucketSize),
        meanUsedBucketSize: usedBucketCount > 0 ? bucketedCount / usedBucketCount : 0,
      },
      queries: this.debugStats.queries,
    };
  }

  private recomputeStaticBucketStats(): void {
    this.staticUsedBucketCount = 0;
    this.staticMaxBucketSize = 0;
    for (const bucket of this.staticBuckets) {
      if (bucket.length === 0) continue;
      this.staticUsedBucketCount++;
      if (bucket.length > this.staticMaxBucketSize) this.staticMaxBucketSize = bucket.length;
    }
  }

  private clearDynamicBuckets(): void {
    for (let i = 0; i < this.usedDynamicBucketIndices.length; i++) {
      const bucketIndex = this.usedDynamicBucketIndices[i];
      this.buckets[bucketIndex].length = 0;
      this.npcBuckets[bucketIndex].length = 0;
      this.monsterBuckets[bucketIndex].length = 0;
    }
    this.usedDynamicBucketIndices.length = 0;
  }

  private addDynamicEntityToBuckets(e: Entity, bucketIndex: number): Entity[] {
    const bucket = this.buckets[bucketIndex];
    if (bucket.length === 0) this.usedDynamicBucketIndices.push(bucketIndex);
    bucket.push(e);
    if (e.type === EntityType.NPC) this.npcBuckets[bucketIndex].push(e);
    else if (e.type === EntityType.MONSTER) this.monsterBuckets[bucketIndex].push(e);
    return bucket;
  }

  private dynamicBucketsForMask(typeMask: number): Entity[][] {
    if (typeMask === ENTITY_MASK_NPC) return this.npcBuckets;
    if (typeMask === ENTITY_MASK_MONSTER) return this.monsterBuckets;
    return this.buckets;
  }

  private reindexStaticEntities(): { liveCount: number; itemCount: number } {
    this.staticIndexedIds.clear();
    let liveCount = 0;
    let itemCount = 0;
    for (const bucket of this.staticBuckets) {
      let write = 0;
      for (const e of bucket) {
        if (!e || !e.alive || (entityMask(e) & ENTITY_MASK_STATIC_VISIBLE) === 0) continue;
        bucket[write++] = e;
        this.staticIndexedIds.add(e.id);
        this.byId.set(e.id, e);
        this.entityOrder.set(e.id, Number.MAX_SAFE_INTEGER - liveCount);
        liveCount++;
        if (e.type === EntityType.ITEM_DROP) itemCount++;
      }
      bucket.length = write;
    }
    this.recomputeStaticBucketStats();
    return { liveCount, itemCount };
  }

  private addEntityTailToCachedBuckets(entities: readonly Entity[]): void {
    if (entities.length <= this.builtEntityCount) return;
    for (let order = Math.max(0, this.builtEntityCount); order < entities.length; order++) {
      const e = entities[order];
      if (!e || !e.alive) continue;
      this.byId.set(e.id, e);
      this.entityOrder.set(e.id, order);
      if ((entityMask(e) & ENTITY_MASK_STATIC_VISIBLE) !== 0) {
        if (this.staticIndexedIds.has(e.id)) continue;
        this.staticIndexedIds.add(e.id);
        const bucketIndex = wrappedBucketCoord(e.y) * BUCKETS_PER_AXIS + wrappedBucketCoord(e.x);
        const bucket = this.staticBuckets[bucketIndex];
        bucket.push(e);
        if (bucket.length === 1) this.staticUsedBucketCount++;
        if (bucket.length > this.staticMaxBucketSize) this.staticMaxBucketSize = bucket.length;
      } else {
        this.dynamicEntities.push(e);
      }
    }
  }

  rebuildForSimulation(entities: readonly Entity[], simulationFrame: number): void {
    if (this.isBuiltFor(entities) && this.simulationFrame === simulationFrame) return;
    if (this.builtFor !== entities || this.dirty || entities.length < this.builtEntityCount) {
      this.rebuild(entities, 'simulation', simulationFrame);
      return;
    }
    this.rebuildDynamicForSimulation(entities, simulationFrame);
  }

  isBuiltFor(entities: readonly Entity[]): boolean {
    return this.builtFor === entities && this.builtEntityCount === entities.length && !this.dirty;
  }

  ensureForCurrentEntities(entities: readonly Entity[]): void {
    if (this.isBuiltFor(entities)) return;
    if (this.builtFor === entities && !this.dirty && entities.length >= this.builtEntityCount) {
      this.appendNewEntities(entities);
      return;
    }
    this.rebuild(entities, 'ensure');
  }

  private appendNewEntities(entities: readonly Entity[]): void {
    if (entities.length <= this.builtEntityCount) return;
    for (let order = Math.max(0, this.builtEntityCount); order < entities.length; order++) {
      const e = entities[order];
      if (!e || !e.alive) continue;
      this.byId.set(e.id, e);
      this.entityOrder.set(e.id, order);
      if (e.type === EntityType.NPC || e.type === EntityType.MONSTER) this.actors.push(e);
      if (e.type === EntityType.NPC) this.debugStats.npcCount++;
      else if (e.type === EntityType.MONSTER) this.debugStats.monsterCount++;
      else if (e.type === EntityType.ITEM_DROP) this.debugStats.itemCount++;
      if (e.needs) this.needs.push(e);
      if (e.ai && (e.type === EntityType.NPC || e.type === EntityType.MONSTER)) this.ai.push(e);
      if (e.type === EntityType.PROJECTILE) {
        this.projectiles.push(e);
        this.debugStats.projectileCount++;
      }

      const bucketIndex = wrappedBucketCoord(e.y) * BUCKETS_PER_AXIS + wrappedBucketCoord(e.x);
      if ((entityMask(e) & ENTITY_MASK_STATIC_VISIBLE) !== 0) {
        if (this.staticIndexedIds.has(e.id)) continue;
        this.staticIndexedIds.add(e.id);
        const bucket = this.staticBuckets[bucketIndex];
        bucket.push(e);
        if (bucket.length === 1) {
          this.staticUsedBucketCount++;
          this.debugStats.buckets.usedBucketCount++;
        }
        if (bucket.length > this.staticMaxBucketSize) this.staticMaxBucketSize = bucket.length;
        if (bucket.length > this.debugStats.buckets.maxBucketSize) {
          this.debugStats.buckets.maxBucketSize = bucket.length;
        }
      } else {
        this.dynamicEntities.push(e);
        const bucket = this.addDynamicEntityToBuckets(e, bucketIndex);
        if (bucket.length === 1) this.debugStats.buckets.usedBucketCount++;
        if (bucket.length > this.debugStats.buckets.maxBucketSize) {
          this.debugStats.buckets.maxBucketSize = bucket.length;
        }
      }
      this.debugStats.liveEntityCount++;
    }
    this.builtEntityCount = entities.length;
    this.version++;
    this.debugStats.version = this.version;
    this.debugStats.rebuildReason = 'simulation';
    this.debugStats.entityCount = entities.length;
    if (this.debugStats.buckets.usedBucketCount > 0) {
      this.debugStats.buckets.meanUsedBucketSize = this.debugStats.liveEntityCount / this.debugStats.buckets.usedBucketCount;
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  getVersion(): number {
    return this.version;
  }

  orderOf(entity: Entity): number {
    return this.entityOrder.get(entity.id) ?? Number.MAX_SAFE_INTEGER;
  }

  copyDebugStats(out: EntityIndexDebugStats): EntityIndexDebugStats {
    out.version = this.debugStats.version;
    out.rebuildReason = this.debugStats.rebuildReason;
    out.simulationFrame = this.debugStats.simulationFrame;
    out.entityCount = this.debugStats.entityCount;
    out.liveEntityCount = this.debugStats.liveEntityCount;
    out.actorCount = this.debugStats.actorCount;
    out.aiCount = this.debugStats.aiCount;
    out.needsCount = this.debugStats.needsCount;
    out.projectileCount = this.debugStats.projectileCount;
    out.npcCount = this.debugStats.npcCount;
    out.monsterCount = this.debugStats.monsterCount;
    out.itemCount = this.debugStats.itemCount;
    out.rebuildMs = this.debugStats.rebuildMs;
    out.buckets.bucketCount = this.debugStats.buckets.bucketCount;
    out.buckets.usedBucketCount = this.debugStats.buckets.usedBucketCount;
    out.buckets.maxBucketSize = this.debugStats.buckets.maxBucketSize;
    out.buckets.meanUsedBucketSize = this.debugStats.buckets.meanUsedBucketSize;
    out.queries.radiusCount = this.debugStats.queries.radiusCount;
    out.queries.pathCount = this.debugStats.queries.pathCount;
    out.queries.bucketChecks = this.debugStats.queries.bucketChecks;
    out.queries.resultCount = this.debugStats.queries.resultCount;
    out.queries.maxResultCount = this.debugStats.queries.maxResultCount;
    out.queries.visibleCount = this.debugStats.queries.visibleCount;
    out.queries.visibleResultCount = this.debugStats.queries.visibleResultCount;
    out.queries.lastVisibleResultCount = this.debugStats.queries.lastVisibleResultCount;
    return out;
  }

  getDebugStats(): EntityIndexDebugStats {
    return this.copyDebugStats(emptyDebugStats());
  }

  queryRadius(
    x: number,
    y: number,
    radius: number,
    out: Entity[],
    typeMask = ENTITY_MASK_VISIBLE,
  ): number {
    out.length = 0;
    const bx = wrappedBucketCoord(x);
    const by = wrappedBucketCoord(y);
    const span = Math.ceil(radius / BUCKET_SIZE);
    const r2 = radius * radius;
    let bucketChecks = 0;
    const includeStatic = (typeMask & ENTITY_MASK_STATIC_VISIBLE) !== 0;
    const dynamicBuckets = this.dynamicBucketsForMask(typeMask);

    for (let oy = -span; oy <= span; oy++) {
      const yy = (by + oy + BUCKETS_PER_AXIS) & BUCKET_MASK;
      for (let ox = -span; ox <= span; ox++) {
        const xx = (bx + ox + BUCKETS_PER_AXIS) & BUCKET_MASK;
        const bucketIndex = yy * BUCKETS_PER_AXIS + xx;
        const bucket = dynamicBuckets[bucketIndex];
        bucketChecks++;
        for (const e of bucket) {
          if (!e.alive) continue;
          if ((entityMask(e) & typeMask) === 0) continue;
          const dx = wrappedDelta(x, e.x);
          const dy = wrappedDelta(y, e.y);
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
        if (!includeStatic) continue;
        const staticBucket = this.staticBuckets[bucketIndex];
        bucketChecks++;
        for (const e of staticBucket) {
          if (!e.alive) continue;
          if ((entityMask(e) & typeMask) === 0) continue;
          const dx = wrappedDelta(x, e.x);
          const dy = wrappedDelta(y, e.y);
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }

    this.recordQuery(typeMask, bucketChecks, out.length, false);
    return out.length;
  }

  queryRadiusCapped(
    x: number,
    y: number,
    radius: number,
    out: Entity[],
    typeMask = ENTITY_MASK_VISIBLE,
    maxResults = Infinity,
  ): number {
    out.length = 0;
    if (maxResults <= 0) return 0;
    const capped = Number.isFinite(maxResults);
    const cap = capped ? Math.max(0, Math.floor(maxResults)) : Infinity;
    if (cap <= 0) return 0;
    const distances: number[] = [];
    const ids: number[] = [];
    const addCandidate = (e: Entity, d2: number): void => {
      if (!capped) {
        out.push(e);
        return;
      }
      if (out.length >= cap) {
        const lastIdx = out.length - 1;
        if (d2 > distances[lastIdx] || (d2 === distances[lastIdx] && e.id >= ids[lastIdx])) return;
      }
      out.push(e);
      distances.push(d2);
      ids.push(e.id);
      let pos = out.length - 1;
      while (pos > 0) {
        const pd2 = distances[pos - 1];
        if (pd2 < d2 || (pd2 === d2 && ids[pos - 1] <= e.id)) break;
        const swapE = out[pos - 1];
        const swapId = ids[pos - 1];
        const swapD2 = distances[pos - 1];
        out[pos - 1] = out[pos];
        ids[pos - 1] = ids[pos];
        distances[pos - 1] = distances[pos];
        out[pos] = swapE;
        ids[pos] = swapId;
        distances[pos] = swapD2;
        pos--;
      }
      if (out.length > cap) {
        out.length = cap;
        distances.length = cap;
        ids.length = cap;
      }
    };
    const bx = wrappedBucketCoord(x);
    const by = wrappedBucketCoord(y);
    const span = Math.ceil(radius / BUCKET_SIZE);
    const r2 = radius * radius;
    let bucketChecks = 0;
    const includeStatic = (typeMask & ENTITY_MASK_STATIC_VISIBLE) !== 0;
    const dynamicBuckets = this.dynamicBucketsForMask(typeMask);

    for (let ring = 0; ring <= span; ring++) {
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (ring > 0 && Math.max(Math.abs(ox), Math.abs(oy)) !== ring) continue;
          const yy = (by + oy + BUCKETS_PER_AXIS) & BUCKET_MASK;
          const xx = (bx + ox + BUCKETS_PER_AXIS) & BUCKET_MASK;
          const bucketIndex = yy * BUCKETS_PER_AXIS + xx;
          let minBucketD2 = -1;
          if (ring > 0) {
            minBucketD2 = bucketMinDistanceSq(x, y, xx, yy);
            if (minBucketD2 > r2) continue;
            if (capped && out.length === cap && minBucketD2 > distances[out.length - 1]) continue;
          }
          const bucket = dynamicBuckets[bucketIndex];
          bucketChecks++;
          for (const e of bucket) {
            if (!e.alive) continue;
            if ((entityMask(e) & typeMask) === 0) continue;
            const dx = wrappedDelta(x, e.x);
            const dy = wrappedDelta(y, e.y);
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            addCandidate(e, d2);
          }
          if (!includeStatic) continue;
          const staticBucket = this.staticBuckets[bucketIndex];
          bucketChecks++;
          for (const e of staticBucket) {
            if (!e.alive) continue;
            if ((entityMask(e) & typeMask) === 0) continue;
            const dx = wrappedDelta(x, e.x);
            const dy = wrappedDelta(y, e.y);
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            addCandidate(e, d2);
          }
        }
      }
    }



    this.recordQuery(typeMask, bucketChecks, out.length, false);
    return out.length;
  }

  queryPathRadius(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    out: Entity[],
    typeMask = ENTITY_MASK_VISIBLE,
    maxResults = Infinity,
  ): number {
    out.length = 0;
    if (radius < 0 || maxResults <= 0) return 0;
    const capped = Number.isFinite(maxResults);
    const cap = capped ? Math.max(0, Math.floor(maxResults)) : Infinity;
    if (cap <= 0) return 0;

    const dx = wrappedDelta(x0, x1);
    const dy = wrappedDelta(y0, y1);
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0.000001) return this.queryRadiusCapped(x0, y0, radius, out, typeMask, maxResults);

    const len = Math.sqrt(len2);
    const steps = Math.max(1, Math.ceil(len / PATH_BUCKET_STEP));
    const span = Math.ceil(radius / BUCKET_SIZE);
    const r2 = radius * radius;
    const visitId = this.nextBucketVisitId();
    let bucketChecks = 0;
    const includeStatic = (typeMask & ENTITY_MASK_STATIC_VISIBLE) !== 0;
    const dynamicBuckets = this.dynamicBucketsForMask(typeMask);
    const hitTs: number[] = [];
    const lateralDistances: number[] = [];
    const ids: number[] = [];
    const candidateBetterThan = (
      hitT: number,
      lateralD2: number,
      id: number,
      otherHitT: number,
      otherLateralD2: number,
      otherId: number,
    ): boolean =>
      hitT < otherHitT
      || (hitT === otherHitT && lateralD2 < otherLateralD2)
      || (hitT === otherHitT && lateralD2 === otherLateralD2 && id < otherId);
    const addCandidate = (e: Entity, hitT: number, lateralD2: number): void => {
      if (!capped) {
        out.push(e);
        return;
      }
      if (out.length >= cap) {
        const worst = cap - 1;
        if (!candidateBetterThan(hitT, lateralD2, e.id, hitTs[worst], lateralDistances[worst], ids[worst])) return;
        hitTs[worst] = hitT;
        lateralDistances[worst] = lateralD2;
        ids[worst] = e.id;
        out[worst] = e;
      } else {
        hitTs.push(hitT);
        lateralDistances.push(lateralD2);
        ids.push(e.id);
        out.push(e);
      }
      let pos = out.length - 1;
      while (pos > 0 && candidateBetterThan(hitTs[pos], lateralDistances[pos], ids[pos], hitTs[pos - 1], lateralDistances[pos - 1], ids[pos - 1])) {
        const swapHitT = hitTs[pos - 1];
        const swapLateral = lateralDistances[pos - 1];
        const swapId = ids[pos - 1];
        const swapEntity = out[pos - 1];
        hitTs[pos - 1] = hitTs[pos];
        lateralDistances[pos - 1] = lateralDistances[pos];
        ids[pos - 1] = ids[pos];
        out[pos - 1] = out[pos];
        hitTs[pos] = swapHitT;
        lateralDistances[pos] = swapLateral;
        ids[pos] = swapId;
        out[pos] = swapEntity;
        pos--;
      }
    };

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bx = wrappedBucketCoord(x0 + dx * t);
      const by = wrappedBucketCoord(y0 + dy * t);
      for (let oy = -span; oy <= span; oy++) {
        const yy = (by + oy + BUCKETS_PER_AXIS) & BUCKET_MASK;
        for (let ox = -span; ox <= span; ox++) {
          const xx = (bx + ox + BUCKETS_PER_AXIS) & BUCKET_MASK;
          const bucketIndex = yy * BUCKETS_PER_AXIS + xx;
          if (this.bucketVisits[bucketIndex] === visitId) continue;
          this.bucketVisits[bucketIndex] = visitId;
          bucketChecks++;
          const bucket = dynamicBuckets[bucketIndex];
          for (const e of bucket) {
            if (!e.alive) continue;
            if ((entityMask(e) & typeMask) === 0) continue;
            const ex = wrappedDelta(x0, e.x);
            const ey = wrappedDelta(y0, e.y);
            let hitT = (ex * dx + ey * dy) / len2;
            if (hitT < 0) hitT = 0;
            else if (hitT > 1) hitT = 1;
            const px = ex - dx * hitT;
            const py = ey - dy * hitT;
            const lateralD2 = px * px + py * py;
            if (lateralD2 <= r2) addCandidate(e, hitT, lateralD2);
          }
          if (!includeStatic) continue;
          bucketChecks++;
          const staticBucket = this.staticBuckets[bucketIndex];
          for (const e of staticBucket) {
            if (!e.alive) continue;
            if ((entityMask(e) & typeMask) === 0) continue;
            const ex = wrappedDelta(x0, e.x);
            const ey = wrappedDelta(y0, e.y);
            let hitT = (ex * dx + ey * dy) / len2;
            if (hitT < 0) hitT = 0;
            else if (hitT > 1) hitT = 1;
            const px = ex - dx * hitT;
            const py = ey - dy * hitT;
            const lateralD2 = px * px + py * py;
            if (lateralD2 <= r2) addCandidate(e, hitT, lateralD2);
          }
        }
      }
    }

    this.recordQuery(typeMask, bucketChecks, out.length, true);
    return out.length;
  }

  private recordQuery(typeMask: number, bucketChecks: number, resultCount: number, pathQuery: boolean): void {
    const q = this.debugStats.queries;
    if (pathQuery) q.pathCount++;
    else q.radiusCount++;
    q.bucketChecks += bucketChecks;
    q.resultCount += resultCount;
    if (resultCount > q.maxResultCount) q.maxResultCount = resultCount;
    if (typeMask === ENTITY_MASK_VISIBLE) {
      q.visibleCount++;
      q.visibleResultCount += resultCount;
      q.lastVisibleResultCount = resultCount;
    }
  }

  private nextBucketVisitId(): number {
    const id = this.bucketVisitId;
    this.bucketVisitId++;
    if (this.bucketVisitId > 0xffff_ffff) {
      this.bucketVisits.fill(0);
      this.bucketVisitId = 1;
    }
    return id;
  }
}

const runtimeEntityIndex = new EntityIndex();

export function rebuildEntityIndex(
  entities: readonly Entity[],
  rebuildReason: EntityIndexRebuildReason = 'manual',
): EntityIndex {
  runtimeEntityIndex.rebuild(entities, rebuildReason);
  return runtimeEntityIndex;
}

export function rebuildEntityIndexForSimulation(entities: readonly Entity[], simulationFrame: number): EntityIndex {
  runtimeEntityIndex.rebuildForSimulation(entities, simulationFrame);
  return runtimeEntityIndex;
}

export function rebuildEntityIndexAfterSpawnCleanup(entities: readonly Entity[]): EntityIndex {
  runtimeEntityIndex.rebuild(entities, 'spawn_cleanup');
  return runtimeEntityIndex;
}

export function markEntityIndexDirty(): void {
  runtimeEntityIndex.markDirty();
}

export function ensureEntityIndex(entities: readonly Entity[]): EntityIndex {
  // Runtime systems should normally read getEntityIndex(); this is only a load/test guard.
  runtimeEntityIndex.ensureForCurrentEntities(entities);
  return runtimeEntityIndex;
}

export function getEntityIndex(): EntityIndex {
  return runtimeEntityIndex;
}
