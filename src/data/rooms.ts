/* ── Room definitions ─────────────────────────────────────────── */

import { RoomType, Tex } from '../core/types';

export interface RoomDef {
  type: RoomType;
  name: string;
  minW: number; maxW: number;
  minH: number; maxH: number;
  wallTex: Tex; floorTex: Tex;
}

export const ROOM_DEFS: Record<RoomType, RoomDef> = {
  [RoomType.LIVING]:     { type: RoomType.LIVING,     name: 'Жилая',        minW:5, maxW:9,  minH:5, maxH:8,  wallTex: Tex.PANEL,     floorTex: Tex.F_WOOD },
  [RoomType.KITCHEN]:    { type: RoomType.KITCHEN,    name: 'Кухня',        minW:4, maxW:7,  minH:4, maxH:6,  wallTex: Tex.TILE_W,    floorTex: Tex.F_LINO },
  [RoomType.BATHROOM]:   { type: RoomType.BATHROOM,   name: 'Санузел',      minW:3, maxW:5,  minH:3, maxH:5,  wallTex: Tex.TILE_W,    floorTex: Tex.F_TILE },
  [RoomType.STORAGE]:    { type: RoomType.STORAGE,    name: 'Кладовая',     minW:3, maxW:6,  minH:3, maxH:6,  wallTex: Tex.CONCRETE,  floorTex: Tex.F_CONCRETE },
  [RoomType.MEDICAL]:    { type: RoomType.MEDICAL,    name: 'Медпункт',     minW:4, maxW:8,  minH:4, maxH:7,  wallTex: Tex.TILE_W,    floorTex: Tex.F_TILE },
  [RoomType.COMMON]:     { type: RoomType.COMMON,     name: 'Зал',          minW:6, maxW:14, minH:6, maxH:12, wallTex: Tex.PANEL,     floorTex: Tex.F_CARPET },
  [RoomType.PRODUCTION]: { type: RoomType.PRODUCTION, name: 'Цех',          minW:6, maxW:12, minH:6, maxH:10, wallTex: Tex.METAL,     floorTex: Tex.F_CONCRETE },
  [RoomType.CORRIDOR]:   { type: RoomType.CORRIDOR,   name: 'Коридор',      minW:2, maxW:3,  minH:8, maxH:20, wallTex: Tex.CONCRETE,  floorTex: Tex.F_LINO },
  [RoomType.SMOKING]:    { type: RoomType.SMOKING,    name: 'Курилка',      minW:3, maxW:6,  minH:3, maxH:5,  wallTex: Tex.CONCRETE,  floorTex: Tex.F_CONCRETE },
  [RoomType.OFFICE]:     { type: RoomType.OFFICE,     name: 'Бухгалтерия',  minW:4, maxW:8,  minH:4, maxH:7,  wallTex: Tex.PANEL,     floorTex: Tex.F_LINO },
  [RoomType.HQ]:         { type: RoomType.HQ,         name: 'Штаб',         minW:7, maxW:7,  minH:7, maxH:7,  wallTex: Tex.METAL,     floorTex: Tex.F_CONCRETE },
  [RoomType.CLASSROOM]:  { type: RoomType.CLASSROOM,  name: 'Класс',        minW:5, maxW:10, minH:5, maxH:8,  wallTex: Tex.PANEL,     floorTex: Tex.F_WOOD },
};
