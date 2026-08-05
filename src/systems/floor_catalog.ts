import { FloorLevel } from '../core/types';
import {
  FLOOR_CATALOG,
  type FloorCatalogDef,
  type FloorCatalogRarity,
  type FloorContentStatus,
} from '../data/floor_catalog';
import { floorLevelDisplayName } from '../gen/floor_manifest';

export interface FloorCatalogQuery {
  readonly baseFloor?: FloorLevel;
  readonly tag?: string;
  readonly tags?: readonly string[];
  readonly rarity?: FloorCatalogRarity | readonly FloorCatalogRarity[];
  readonly minDepth?: number;
  readonly contentStatus?: FloorContentStatus | readonly FloorContentStatus[];
  readonly search?: string;
  readonly limit?: number;
}

function matchesFilter<T extends string>(value: T, filter: T | readonly T[] | undefined): boolean {
  if (filter === undefined) return true;
  return Array.isArray(filter) ? filter.includes(value) : value === filter;
}

function hasAllTags(def: FloorCatalogDef, tags: readonly string[]): boolean {
  for (const tag of tags) if (!def.tags.includes(tag)) return false;
  return true;
}

function matchesSearch(def: FloorCatalogDef, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    def.id.toLowerCase().includes(q) ||
    def.displayName.toLowerCase().includes(q) ||
    def.unlockHint.toLowerCase().includes(q) ||
    def.tags.some(tag => tag.toLowerCase().includes(q))
  );
}

export function getFloorCatalogDef(id: string): FloorCatalogDef | undefined {
  return FLOOR_CATALOG.find(def => def.id === id);
}

export function queryFloorCatalog(query: FloorCatalogQuery = {}): FloorCatalogDef[] {
  const tags = query.tags ? [...query.tags] : [];
  if (query.tag) tags.push(query.tag);
  const limit = Math.max(0, query.limit ?? FLOOR_CATALOG.length);
  const out: FloorCatalogDef[] = [];
  if (limit === 0) return out;

  for (const def of FLOOR_CATALOG) {
    if (query.baseFloor !== undefined && def.baseFloor !== query.baseFloor) continue;
    if (query.minDepth !== undefined && def.minDepth > query.minDepth) continue;
    if (!matchesFilter(def.rarity, query.rarity)) continue;
    if (!matchesFilter(def.contentStatus, query.contentStatus)) continue;
    if (!hasAllTags(def, tags)) continue;
    if (query.search !== undefined && !matchesSearch(def, query.search)) continue;
    out.push(def);
    if (out.length >= limit) break;
  }

  return out;
}

export function eligibleFloorPockets(
  baseFloor: FloorLevel,
  depth: number,
  query: Omit<FloorCatalogQuery, 'baseFloor' | 'minDepth'> = {},
): FloorCatalogDef[] {
  return queryFloorCatalog({ ...query, baseFloor, minDepth: depth });
}

export function eligibleFloorPocketsByTag(
  baseFloor: FloorLevel,
  tag: string,
  depth: number,
  rarity?: FloorCatalogRarity | readonly FloorCatalogRarity[],
): FloorCatalogDef[] {
  return eligibleFloorPockets(baseFloor, depth, { tag, rarity });
}

export function searchFloorCatalog(search: string, query: Omit<FloorCatalogQuery, 'search'> = {}): FloorCatalogDef[] {
  return queryFloorCatalog({ ...query, search });
}

export function formatFloorCatalogLine(def: FloorCatalogDef): string {
  return `${def.id} | ${def.displayName} | ${floorLevelDisplayName(def.baseFloor)} | ${def.rarity} d${def.minDepth} | ${def.contentStatus}`;
}

export function floorCatalogDebugLines(query: FloorCatalogQuery = {}): string[] {
  const rows = queryFloorCatalog(query);
  const scope = query.search?.trim()
    ? `search="${query.search.trim()}"`
    : query.baseFloor !== undefined
      ? floorLevelDisplayName(query.baseFloor)
      : 'all';
  const lines = [`catalog ${scope}: ${rows.length}/${FLOOR_CATALOG.length}`];
  for (const def of rows) lines.push(formatFloorCatalogLine(def));
  return lines;
}
