/* ── Content manifest utilities ─────────────────────────────────
 * Tiny helpers shared by floor manifests. Keep generation order in
 * manifests; keep mechanics in content modules.
 */

import { EntityType, type Entity } from '../core/types';
import { type World } from '../core/world';

export type PoiDecisionHookKind =
  | 'quest'
  | 'contract'
  | 'rumor'
  | 'trade'
  | 'steal'
  | 'repair'
  | 'escort'
  | 'kill'
  | 'hide'
  | 'forge'
  | 'expose'
  | 'reroute'
  | 'flee'
  | 'debug';

export interface PoiDecisionHookMetadata {
  id: string;
  kind?: PoiDecisionHookKind;
  label?: string;
}

export interface PoiGenerationMetadata {
  id: string;
  floor?: string;
  debugLabel?: string;
  roomIds?: readonly number[];
  npcIds?: readonly number[];
  containerIds?: readonly number[];
  decisionHooks?: readonly PoiDecisionHookMetadata[];
}

export type PoiGenerationMetadataDef = Omit<PoiGenerationMetadata, 'roomIds' | 'npcIds' | 'containerIds'>;

const poiGenerationMetadataByWorld = new WeakMap<World, PoiGenerationMetadata[]>();

export function syncNextEntityId(entities: Entity[], nextId: number): number {
  let max = nextId;
  for (let i = 0; i < entities.length; i++) {
    if (entities[i].id >= max) max = entities[i].id + 1;
  }
  return max;
}

function uniqueNumbers(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function recordPoiGenerationMetadata(world: World, metadata: PoiGenerationMetadata): void {
  const entries = poiGenerationMetadataByWorld.get(world) ?? [];
  const normalized: PoiGenerationMetadata = {
    ...metadata,
    roomIds: metadata.roomIds ? uniqueNumbers(metadata.roomIds) : undefined,
    npcIds: metadata.npcIds ? uniqueNumbers(metadata.npcIds) : undefined,
    containerIds: metadata.containerIds ? uniqueNumbers(metadata.containerIds) : undefined,
  };
  const existing = entries.findIndex(entry => entry.id === normalized.id);
  if (existing >= 0) entries[existing] = normalized;
  else entries.push(normalized);
  poiGenerationMetadataByWorld.set(world, entries);
}

export function clearPoiGenerationMetadata(world: World): void {
  poiGenerationMetadataByWorld.delete(world);
}

export function getPoiGenerationMetadata(world: World): readonly PoiGenerationMetadata[] {
  return poiGenerationMetadataByWorld.get(world) ?? [];
}

export function withPoiGenerationMetadata<T>(
  world: World,
  entities: Entity[],
  metadata: PoiGenerationMetadataDef,
  generate: () => T,
): T {
  const beforeRoomIds = new Set<number>();
  for (const room of world.rooms) if (room) beforeRoomIds.add(room.id);
  const beforeEntityCount = entities.length;
  const beforeContainerCount = world.containers.length;

  const result = generate();

  const roomIds: number[] = [];
  for (const room of world.rooms) {
    if (room && !beforeRoomIds.has(room.id)) roomIds.push(room.id);
  }
  const npcIds = entities
    .slice(beforeEntityCount)
    .filter(entity => entity.type === EntityType.NPC)
    .map(entity => entity.id);
  const containerIds = world.containers
    .slice(beforeContainerCount)
    .map(container => container.id);

  recordPoiGenerationMetadata(world, {
    ...metadata,
    roomIds,
    npcIds,
    containerIds,
  });

  return result;
}
