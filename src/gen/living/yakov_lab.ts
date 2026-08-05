/* ── Лаборатория Якова Давидовича — PSI researcher lab ─────────── */
/*   Self-contained content module (по аналогии с start_room.ts): */
/*     • Лаборатория 7×7 — белая плитка, аппаратура, полки        */
/*     • NPC: Яков Давидович (учёный, исследователь ПСИ)          */
/*     • Генерируется на расстоянии 10–50 клеток от спавна       */
/*     • Если есть MEDICAL-комната — захватывает её               */
/*     • Если нет — штампует новую 7×7 комнату + защищает aptMask */
/*                                                                 */
/*   Подключается одной строкой в living/index.ts.                */

import {
  W, Cell, Tex, RoomType, Feature,
  type Room, type Entity,
  EntityType,
} from '../../core/types';
import { World } from '../../core/world';
import { stampRoom, protectRoom, findClearArea } from '../shared';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { Spr } from '../../render/sprite_index';
import { placeCraftStationAt, type CraftStationDefId } from '../craft_stations';

const LAB_MIN_DIST = 10;
const LAB_MAX_DIST = 50;

function placeProtectedLabStation(
  world: World,
  room: Room,
  defId: CraftStationDefId,
  feature: Feature,
  offsets: readonly (readonly [number, number])[],
): boolean {
  for (const [dx, dy] of offsets) {
    const x = world.wrap(room.x + dx);
    const y = world.wrap(room.y + dy);
    const idx = world.idx(x, y);
    if (world.cells[idx] !== Cell.FLOOR || world.doors.has(idx) || world.containerMap.has(idx)) continue;
    if (world.surfaceFlags[idx] !== 0) continue;

    const oldFeature = world.features[idx] as Feature;
    world.features[idx] = feature;
    const placed = placeCraftStationAt(world, x, y, defId, {
      allowProtectedExistingFeature: true,
      seed: ((room.id + 1) * 4099 + idx + dx * 17 + dy * 31) >>> 0,
      tags: ['craft_station', 'living_fixed', 'yakov_lab'],
    });
    if (placed) return true;
    world.features[idx] = oldFeature;
  }
  return false;
}

function placeYakovLabCraftStations(world: World, room: Room): void {
  placeProtectedLabStation(world, room, 'disassembly_workbench', Feature.TABLE, [
    [1, room.h - 2],
    [1, 2],
    [2, room.h - 2],
    [2, 1],
  ]);
  placeProtectedLabStation(world, room, 'craft_lathe', Feature.MACHINE, [
    [room.w - 2, room.h - 2],
    [room.w - 2, 2],
    [room.w - 3, room.h - 2],
    [room.w - 2, 1],
  ]);
}

export function generateYakovLab(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  spawnX: number, spawnY: number,
): { room: Room; nextRoomId: number } {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);

  let room: Room;

  // ── Strategy A: find an existing MEDICAL room at moderate distance ──
  const candidates = world.rooms.filter(r => {
    if (!r || r.w < 4 || r.h < 4) return false;
    if (r.type !== RoomType.MEDICAL) return false;
    if (r.apartmentId >= 0) return false; // never take over apartment rooms
    const d = world.dist(cx, cy, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2));
    return d >= LAB_MIN_DIST && d <= LAB_MAX_DIST;
  });

  if (candidates.length > 0) {
    room = candidates[Math.floor(Math.random() * candidates.length)];
    room.name = 'Лаборатория';
    room.wallTex = Tex.TILE_W;
    room.floorTex = Tex.F_TILE;
    protectRoom(world, room.x, room.y, room.w, room.h, Tex.TILE_W, Tex.F_TILE);
    // Apparatus + lamp
    world.features[world.idx(room.x + 1, room.y + 1)] = Feature.APPARATUS;
    world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))] = Feature.LAMP;
  } else {
    // ── Strategy B: stamp a new 7×7 lab at random angle from spawn ──
    const labW = 7, labH = 7;
    const pos = findClearArea(world, cx, cy, labW, labH, LAB_MIN_DIST, LAB_MAX_DIST);
    const labX = pos ? pos.x : (cx + 100) % W;
    const labY = pos ? pos.y : (cy + 100) % W;

    room = stampRoom(world, nextRoomId++, RoomType.MEDICAL, labX, labY, labW, labH, -1);
    room.name = 'Лаборатория';
    room.wallTex = Tex.TILE_W;
    room.floorTex = Tex.F_TILE;
    protectRoom(world, labX, labY, labW, labH, Tex.TILE_W, Tex.F_TILE);

    // Lamps + apparatus + shelf
    world.features[world.idx(labX + Math.floor(labW / 2), labY + Math.floor(labH / 2))] = Feature.LAMP;
    world.features[world.idx(labX + 1, labY + 1)] = Feature.APPARATUS;
    world.features[world.idx(labX + labW - 2, labY + 1)] = Feature.SHELF;
  }

  placeYakovLabCraftStations(world, room);

  const labCx = room.x + Math.floor(room.w / 2);
  const labCy = room.y + Math.floor(room.h / 2);
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'yakov', labCx + 0.5, labCy + 0.5, { angle: Math.PI });

  // ── Guaranteed idol spawn within 50 cells of Yakov's lab ──
  const IDOL_SEARCH_R = 50;
  let idolPlaced = false;
  for (let attempt = 0; attempt < 3000 && !idolPlaced; attempt++) {
    const ox = labCx + Math.floor(Math.random() * IDOL_SEARCH_R * 2) - IDOL_SEARCH_R;
    const oy = labCy + Math.floor(Math.random() * IDOL_SEARCH_R * 2) - IDOL_SEARCH_R;
    const wx = ((ox % W) + W) % W;
    const wy = ((oy % W) + W) % W;
    if (world.cells[world.idx(wx, wy)] !== Cell.FLOOR) continue;
    if (world.dist(labCx, labCy, wx, wy) > IDOL_SEARCH_R) continue;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: wx + 0.5, y: wy + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: 'idol_chernobog', count: 1 }],
    });
    idolPlaced = true;
  }

  return { room, nextRoomId };
}
