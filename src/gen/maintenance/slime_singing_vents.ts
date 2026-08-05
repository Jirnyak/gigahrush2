/* ── Slime-singing vent: rare Maintenance route/sample cue ───── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell,
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { registerRouteCue } from '../../systems/route_cues';
import {
  type MaintContentCtx, findMaintArea, openTile, setFeature, setWater,
  spawnMonstersNear, stampMaintRoom,
} from './content_helpers';

const VENT_ROOM_NAME = 'Поющий вентканал НИИ: слизь в решетке';
const SAMPLE_ROOM_NAME = 'Слизистый пробоотборник: аварийная ниша';
const BROWN_SAMPLE_ITEM = 'slime_sample_brown';

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
  return id;
}

function addSampleJar(ctx: MaintContentCtx, room: Room, x: number, y: number): void {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  const container: WorldContainer = {
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    kind: ContainerKind.MEDICAL_CABINET,
    name: 'Запаянная банка под поющим вентилем',
    inventory: [
      { defId: 'strange_clot', count: 1, data: 'Слизистый образец с поющего вентканала.' },
      { defId: BROWN_SAMPLE_ITEM, count: 1, data: 'Запаянная проба с вентканала. Пост НИИ примет как коричневую, печь — как опасную.' },
      { defId: 'smoke_candle_check', count: 2 },
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'note', count: 1, data: 'Не брать, если песня идет в обе стороны. В акте писать: давление, не голос. Пломбу не вскрывать: Бокова запишет, Вера прожжет, Сеня купит.' },
    ],
    capacitySlots: 6,
    faction: Faction.SCIENTIST,
    access: 'public',
    discovered: true,
    tags: ['slime', 'sample', 'route_cue', 'nii'],
  };
  ctx.world.addContainer(container);
  setFeature(ctx.world, wx, wy, Feature.SHELF);
}

function connectVentToSample(ctx: MaintContentCtx, vent: Room, sample: Room): void {
  const y = vent.y + 2;
  for (let x = vent.x + vent.w; x <= sample.x; x++) openTile(ctx.world, x, y, Tex.F_CONCRETE);
  for (let yy = Math.min(y, sample.y + 2); yy <= Math.max(y, sample.y + 2); yy++) {
    openTile(ctx.world, sample.x + 1, yy, Tex.F_CONCRETE);
  }
}

function stampSlimeResidue(ctx: MaintContentCtx, vent: Room, sample: Room): void {
  for (let dx = 1; dx < vent.w - 1; dx++) {
    const x = vent.x + dx;
    const y = vent.y + 2;
    if (dx % 2 === 0) stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.24, 110, vent.id * 97 + dx, 42, 100, 38);
  }
  for (let dx = 1; dx < sample.w - 1; dx += 2) {
    const x = sample.x + dx;
    const y = sample.y + sample.h - 2;
    stampSurfaceSplat(ctx.world, x, y, 0.48, 0.56, 0.34, 150, sample.id * 131 + dx, 22, 54, 26);
    ctx.world.fog[ctx.world.idx(x, y)] = Math.max(ctx.world.fog[ctx.world.idx(x, y)], 65);
  }
  ctx.world.markFogDirty();
}

function dressRooms(ctx: MaintContentCtx, vent: Room, sample: Room): void {
  setFeature(ctx.world, vent.x + 1, vent.y + 1, Feature.LAMP);
  setFeature(ctx.world, vent.x + 3, vent.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, vent.x + 5, vent.y + 2, Feature.MACHINE);
  setWater(ctx.world, vent.x + 2, vent.y + 3);

  for (let dx = 1; dx < sample.w - 1; dx++) {
    if (dx % 2 === 0) setFeature(ctx.world, sample.x + dx, sample.y + 1, Feature.APPARATUS);
    if (dx % 3 === 0) setWater(ctx.world, sample.x + dx, sample.y + sample.h - 2);
  }
  setFeature(ctx.world, sample.x + 1, sample.y + 1, Feature.SCREEN);
  setFeature(ctx.world, sample.x + sample.w - 2, sample.y + 2, Feature.LAMP);
}

export function generateSlimeSingingVents(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 24, 11, 80, 175);

  const vent = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y + 3, 8, 5,
    VENT_ROOM_NAME,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const sample = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.MEDICAL,
    pos.x + 13, pos.y + 1, 10, 8,
    SAMPLE_ROOM_NAME,
    Tex.METAL, Tex.F_CONCRETE,
  );

  connectVentToSample(ctx, vent, sample);
  dressRooms(ctx, vent, sample);
  stampSlimeResidue(ctx, vent, sample);
  addSampleJar(ctx, sample, sample.x + sample.w - 2, sample.y + sample.h - 2);

  spawnMonstersNear(ctx, sample.x + 5, sample.y + 4, [
    MonsterKind.EYE, MonsterKind.POLZUN,
  ], 3, 7);

  const markerX = vent.x + 4.5;
  const markerY = vent.y + 2.5;
  const targetX = sample.x + sample.w - 2 + 0.5;
  const targetY = sample.y + sample.h - 2 + 0.5;
  const markerCell = ctx.world.idx(Math.floor(markerX), Math.floor(markerY));
  const targetCell = ctx.world.idx(Math.floor(targetX), Math.floor(targetY));
  if (ctx.world.cells[markerCell] !== Cell.LIFT && ctx.world.cells[targetCell] !== Cell.LIFT) {
    registerRouteCue(ctx.world, {
      id: 'maintenance_slime_singing_vent',
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: FloorLevel.MAINTENANCE,
      roomId: vent.id,
      targetRoomId: sample.id,
      zoneId: ctx.world.zoneMap[markerCell],
      label: 'поющий вентиль',
      hint: 'тон тянет к пробоотборнику',
      targetName: 'банка образца',
      color: '#9f7',
      tags: ['maintenance', 'slime', 'sample', 'vent', 'nii'],
      toneSeed: vent.id * 1009 + sample.id * 37,
      radius: 10,
      targetRadius: 2.8,
      cooldownSec: 28,
      heardText: 'Вентиляция берет мокрую ноту. HUD ловит направление к пробоотборнику.',
      followedText: 'Пение вывело к банке образца. Брать ее или оставить нишу закрытой - уже выбор.',
      ignoredText: 'Пение вентиля стихло за спиной. Образец остался в аварийной нише.',
    });
  }
}
