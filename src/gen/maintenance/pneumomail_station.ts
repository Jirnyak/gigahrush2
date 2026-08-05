/* ── AG114 Pneumomail station: rumor capsules through old tubes ─ */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell,
  Feature,
  Faction,
  Occupation,
  RoomType,
  Tex,
} from '../../core/types';
import { PNEUMOMAIL_ROOM_NAME, PNEUMOMAIL_SORTER_ROOM_NAME } from '../../data/pneumomail';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  spawnAmbientNpc, stampMaintRoom,
} from './content_helpers';

export function generatePneumomailStation(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 28, 14, 42, 125);

  const station = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.OFFICE,
    pos.x, pos.y, 19, 9,
    PNEUMOMAIL_ROOM_NAME,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const sorter = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 22, pos.y + 1, 7, 7,
    PNEUMOMAIL_SORTER_ROOM_NAME,
    Tex.METAL, Tex.F_CONCRETE,
  );

  for (let x = station.x + station.w; x <= sorter.x; x++) openTile(ctx.world, x, station.y + 4);

  setFeature(ctx.world, station.x + 3, station.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, station.x + 3, station.y + 3, Feature.APPARATUS);
  setFeature(ctx.world, station.x + 7, station.y + 2, Feature.MACHINE);
  setFeature(ctx.world, station.x + 10, station.y + 2, Feature.DESK);
  setFeature(ctx.world, station.x + 14, station.y + 2, Feature.SCREEN);
  setFeature(ctx.world, station.x + 16, station.y + 6, Feature.LAMP);
  setFeature(ctx.world, station.x + 5, station.y + 6, Feature.CHAIR);
  setFeature(ctx.world, sorter.x + 2, sorter.y + 2, Feature.SHELF);
  setFeature(ctx.world, sorter.x + 4, sorter.y + 2, Feature.SHELF);
  setFeature(ctx.world, sorter.x + 5, sorter.y + 5, Feature.LAMP);

  for (let dx = 2; dx < station.w - 2; dx += 4) {
    const ci = ctx.world.idx(station.x + dx, station.y + station.h - 2);
    if (ctx.world.cells[ci] !== Cell.LIFT) stampSurfaceSplat(ctx.world, station.x + dx, station.y + station.h - 2, 0.45, 0.35, 0.22, 90, 9100 + dx, 120, 96, 48);
  }

  spawnAmbientNpc(ctx, 'Инга Трубная', Faction.CITIZEN, Occupation.STOREKEEPER, station.x + 12, station.y + 5, [
    { defId: 'water_coupon', count: 3 },
    { defId: 'duct_tape', count: 1 },
    { defId: 'pneumomail_capsule', count: 1 },
  ]);

  dropItems(ctx, station, ['note', 'wire_coil', 'duct_tape', 'pressure_logbook']);
  dropItems(ctx, sorter, ['pneumomail_capsule', 'pressure_logbook', 'forged_permit_slip']);
}
