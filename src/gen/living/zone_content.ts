/* ── Zone Content Module Registry ────────────────────────────── */
/*   Modular system for placing hand-crafted content in zones.   */
/*   Each module registers a generator function for a specific   */
/*   zone (by HUD number, 1-indexed).                           */
/*                                                               */
/*   Runs AFTER volatile maze generation — modules can bulldoze  */
/*   maze corridors and stamp their own rooms / NPCs / items.    */
/*   Created rooms get aptMask → survive samosbor.               */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';
import { genLog } from '../log';

/* ── Generator function signature ────────────────────────────── */
export type ZoneContentGenerator = (
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  /** Zone center X (cell coords, from zone.cx) */
  zoneCx: number,
  /** Zone center Y (cell coords, from zone.cy) */
  zoneCy: number,
) => { nextRoomId: number };

/* ── Internal registry ───────────────────────────────────────── */
interface ZoneContentEntry {
  /** Zone HUD number (1-indexed, as shown on screen) */
  zoneHudId: number;
  /** Human-readable label for debug logs */
  label: string;
  /** Generator function */
  generate: ZoneContentGenerator;
}

const registry: ZoneContentEntry[] = [];

export interface ZoneContentRegistrySnapshot {
  readonly zoneHudId: number;
  readonly label: string;
}

/* ── Register a zone content module ──────────────────────────── */
/**
 * Call at module top-level (side-effect import).
 * @param zoneHudId Zone number as shown on HUD (1-indexed)
 * @param label     Debug label (e.g. "Orthodox temple")
 * @param generate  Generator function
 */
export function registerZoneContent(
  zoneHudId: number,
  label: string,
  generate: ZoneContentGenerator,
): void {
  const trimmedLabel = label.trim();
  if (!Number.isInteger(zoneHudId) || zoneHudId <= 0) {
    throw new Error(`[ZONE_CONTENT] invalid zone HUD #${zoneHudId} while registering "${trimmedLabel || '<missing label>'}"`);
  }
  if (!trimmedLabel) {
    throw new Error(`[ZONE_CONTENT] missing label for zone HUD #${zoneHudId}`);
  }
  if (registry.some(entry => entry.zoneHudId === zoneHudId)) {
    throw new Error(`[ZONE_CONTENT] duplicate zone HUD #${zoneHudId} while registering "${trimmedLabel}"`);
  }
  if (registry.some(entry => entry.label === trimmedLabel)) {
    throw new Error(`[ZONE_CONTENT] duplicate label "${trimmedLabel}"`);
  }
  registry.push({ zoneHudId, label: trimmedLabel, generate });
}

export function getZoneContentRegistrySnapshot(): readonly ZoneContentRegistrySnapshot[] {
  return registry.map(({ zoneHudId, label }) => ({ zoneHudId, label }));
}

/* ── Run all registered zone content modules ─────────────────── */
/**
 * Called from index.ts after generateVolatileMaze().
 * Iterates registered modules, resolves zone, invokes generator.
 */
export function runZoneContentModules(
  world: World,
  entities: Entity[],
  nextId: { v: number },
): void {
  for (const entry of registry) {
    const zoneIdx = entry.zoneHudId - 1; // HUD is 1-indexed, array is 0-indexed
    const zone = world.zones[zoneIdx];
    if (!zone) {
      throw new Error(`[ZONE_CONTENT] zone HUD #${entry.zoneHudId} (idx ${zoneIdx}) not found for "${entry.label}"`);
    }
    genLog(`[ZONE_CONTENT] running "${entry.label}" in zone HUD #${entry.zoneHudId} center=(${zone.cx}, ${zone.cy})`);
    const result = entry.generate(
      world, world.rooms.length, entities, nextId,
      zone.cx, zone.cy,
    );
    // Update nextId from entities array
    nextId.v = entities.reduce((mx, e) => Math.max(mx, e.id), nextId.v - 1) + 1;
    // Protect new rooms from volatile wipe
    world.apartmentRoomCount = Math.max(world.apartmentRoomCount, result.nextRoomId);
  }
}
