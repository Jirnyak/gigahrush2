/* ── AG70 seroburmaline no-look POI ───────────────────────────── */

import {
  Cell,
  Faction,
  Feature,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  type Room,
} from '../../core/types';
import { MarkType, stampMark } from '../../systems/surface_marks';
import {
  forSeroburmalineSourceCells,
  SEROBURMALINE_ACTIVE_FEATURE,
  SEROBURMALINE_ROOM_PREFIX,
} from '../../systems/seroburmaline';
import { placeDoor } from '../shared';
import { genLog } from '../log';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature,
  spawnAmbientNpc, spawnMonstersNear, stampMaintRoom,
} from './content_helpers';

function setDoorMetal(ctx: MaintContentCtx, rooms: Room[]): void {
  for (const room of rooms) {
    for (const doorIdx of room.doors) {
      if (ctx.world.cells[doorIdx] === Cell.DOOR) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
    }
  }
}

function markWarningSource(ctx: MaintContentCtx, room: Room, x: number, y: number, n: number): void {
  setFeature(ctx.world, x, y, SEROBURMALINE_ACTIVE_FEATURE);
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.82, MarkType.SEROBURMALINE, 70070 + room.id * 17 + n, 142, 92, 124, 230);
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.32, MarkType.PSI, 71070 + room.id * 19 + n, 96, 58, 138, 170);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ci = ctx.world.idx(x + dx, y + dy);
      if (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.LIFT) continue;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 42 + (Math.abs(dx) + Math.abs(dy)) * 8);
    }
  }
}

function decoratePost(ctx: MaintContentCtx, room: Room): void {
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.DESK);
  setFeature(ctx.world, room.x + 2, room.y + 4, Feature.SHELF);
  setFeature(ctx.world, room.x + 2, room.y + 7, Feature.SHELF);
  setFeature(ctx.world, room.x + 5, room.y + 2, Feature.LAMP);
  setFeature(ctx.world, room.x + 5, room.y + 10, Feature.LAMP);
  dropItems(ctx, room, ['duct_tape', 'sealant_tube', 'inspection_mirror', 'psi_stabilizer']);
  spawnAmbientNpc(
    ctx,
    'Лида Серобур',
    Faction.SCIENTIST,
    Occupation.SCIENTIST,
    room.x + 4,
    room.y + 6,
    [{ defId: 'inspection_mirror', count: 1 }, { defId: 'duct_tape', count: 1 }],
  );
}

function decorateChamber(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setFeature(ctx.world, room.x + dx, room.y + 1, Feature.SCREEN);
    setFeature(ctx.world, room.x + dx, room.y + room.h - 2, Feature.SHELF);
  }
  setFeature(ctx.world, room.x + 3, room.y + 3, Feature.LAMP);
  let n = 0;
  forSeroburmalineSourceCells(ctx.world, room, (x, y) => {
    markWarningSource(ctx, room, x, y, n++);
  });
  ctx.world.markFogDirty();
}

function decorateBypass(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(ctx.world, room.x + dx, room.y + 2, Feature.LAMP);
    stampMark(ctx.world, room.x + dx, room.y + 2, 0.5, 0.5, 0.18, MarkType.SCORCH, 72070 + room.id * 11 + dx, 55, 62, 60, 95);
  }
  dropItems(ctx, room, ['psi_dust', 'strange_clot', 'cloth_roll']);
}

export function generateSeroburmalineNoLook(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 39, 17, 80, 190);

  const post = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.OFFICE,
    pos.x, pos.y + 1, 9, 13,
    `${SEROBURMALINE_ROOM_PREFIX} пост наблюдения`,
    Tex.METAL, Tex.F_TILE,
  );
  const chamber = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 10, pos.y + 1, 17, 7,
    `${SEROBURMALINE_ROOM_PREFIX} коридор не смотреть`,
    Tex.ROTTEN, Tex.F_CONCRETE,
  );
  const bypass = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + 10, pos.y + 9, 17, 5,
    `${SEROBURMALINE_ROOM_PREFIX} нижний обход`,
    Tex.PIPE, Tex.F_CONCRETE,
  );

  placeDoor(ctx.world, post, chamber, '', false);
  placeDoor(ctx.world, post, bypass, '', false);
  placeDoor(ctx.world, chamber, bypass, '', false);
  setDoorMetal(ctx, [post, chamber, bypass]);

  decoratePost(ctx, post);
  decorateChamber(ctx, chamber);
  decorateBypass(ctx, bypass);
  spawnMonstersNear(ctx, chamber.x + chamber.w - 4, chamber.y + 3, [MonsterKind.EYE], 6, 11);

  genLog(`[AG70] ${chamber.name} at (${chamber.x}, ${chamber.y}) room #${chamber.id}; safe bypass #${bypass.id}`);
}
