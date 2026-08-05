import type { World } from '../core/world';
import { Cell, type Room, RoomType, W } from '../core/types';

/**
 * Render-only per-cell ceiling-height tiers.
 *
 * The walk level never changes — only the rendered wall top / ceiling plane is
 * raised so different spaces read with a different vertical volume:
 *   tier 0 → plain rooms (default 1.0 wall height)
 *   tier 1 → corridors / open passages sit taller than plain rooms
 *   tier 2 → large rooms
 *   tier 3 → grand halls
 *
 * Two generation-time passes, both cell-based so it does not depend on every
 * corridor being a `Room` record:
 *   1. Every open (non-wall) cell gets a tier from its room (type/area) or, if
 *      it is a carved passage with no room record, the corridor tier.
 *   2. Every wall cell rises to the tallest open cell it bounds, so the wall a
 *      ray actually hits carries the volume of the space behind it.
 *
 * Nothing here touches gameplay, collision, AI or save state — it is pure
 * render metadata, regenerated whenever a floor is built or restored.
 *
 * Expandable / tweakable: change the tier constants, the `LARGE_AREA` /
 * `GRAND_AREA` thresholds, or branch on more `RoomType`s. The shader maps tier
 * `t` to height `1 + t*0.5`.
 */

const TIER_ROOM = 0;
const TIER_CORRIDOR = 1;
const TIER_LARGE = 2;
const TIER_GRAND = 3;

const LARGE_AREA = 80;   // w*h at/above which a room reads as a hall
const GRAND_AREA = 150;  // ...and a grand hall

const MASK = W - 1;      // W is a power of two, so wrap == & MASK

function ceilingTierForRoom(room: Room): number {
  if (room.ceilingTier !== undefined) return room.ceilingTier;
  if (room.type === RoomType.CORRIDOR) return TIER_CORRIDOR;
  const area = room.w * room.h;
  if (area >= GRAND_AREA) return TIER_GRAND;
  if (area >= LARGE_AREA) return TIER_LARGE;
  return TIER_ROOM;
}

export function stampCeilingHeights(world: World): void {
  const { cells, roomMap, rooms } = world;
  const ceil = world.ceilHeight;
  const n = W * W;

  // Pass 1: open cells get their volume tier; walls start flat.
  for (let i = 0; i < n; i++) {
    if (cells[i] === Cell.WALL) { ceil[i] = 0; continue; }
    if (world.globalCeilingTier !== undefined) {
      ceil[i] = world.globalCeilingTier;
      continue;
    }
    const rid = roomMap[i];
    const room = rid >= 0 ? rooms[rid] : undefined;
    ceil[i] = room ? ceilingTierForRoom(room) : TIER_CORRIDOR;
  }

  // Pass 2: each wall rises to the tallest open cell it bounds. Only open
  // neighbours contribute (their stable pass-1 tier), so writing walls in this
  // same pass never propagates height along a wall line.
  for (let y = 0; y < W; y++) {
    const rowUp = ((y - 1) & MASK) * W;
    const rowMid = y * W;
    const rowDn = ((y + 1) & MASK) * W;
    for (let x = 0; x < W; x++) {
      const i = rowMid + x;
      if (cells[i] !== Cell.WALL) continue;
      const xL = (x - 1) & MASK;
      const xR = (x + 1) & MASK;
      let m = 0;
      let j = rowUp + xL; if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowUp + x;      if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowUp + xR;     if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowMid + xL;    if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowMid + xR;    if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowDn + xL;     if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowDn + x;      if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      j = rowDn + xR;     if (cells[j] !== Cell.WALL && ceil[j] > m) m = ceil[j];
      
      // If a global ceiling is used (like the sky), do not let the walls rise to the sky level.
      // Instead, assign a deterministic pseudo-random height to create a varied skyline of parapets.
      if (world.globalCeilingTier !== undefined && m === world.globalCeilingTier) {
        const rid = roomMap[i];
        if (rid >= 0) {
          // If the wall belongs to a room, use a consistent height for the whole room
          const hash = (rid * 113) % 100;
          if (hash < 15) m = TIER_GRAND;
          else if (hash < 40) m = TIER_LARGE;
          else if (hash < 75) m = TIER_CORRIDOR;
          else m = TIER_ROOM;
        } else {
          // For abyss walls with no room, use a chunked spatial hash
          const hash = ((x >> 3) * 73 + (y >> 3) * 13) % 100;
          if (hash < 10) m = TIER_GRAND;
          else if (hash < 30) m = TIER_LARGE;
          else if (hash < 65) m = TIER_CORRIDOR;
          else m = TIER_ROOM;
        }
      }
      
      ceil[i] = m;
    }
  }

  world.markCeilHeightDirty();
}
