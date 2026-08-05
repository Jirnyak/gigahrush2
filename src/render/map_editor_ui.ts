import {
  Cell, DoorState, EntityType, Feature, LiftDirection, RoomType, W,
  type Entity,
} from '../core/types';
import type { World } from '../core/world';
import { drawGlitchText, drawNeuroPanel, drawStaticNoise } from './hud_fx';
import { fitText } from './ui_text';
import { menuCloseHint } from '../systems/controls';
import { isPlayerEntity } from '../systems/player_actor';

export type MapEditorToolId = 'cell' | 'door' | 'texture' | 'feature' | 'entity' | 'container' | 'inspect' | string;
export type MapEditorDirtyCell = number | { x: number; y: number; idx?: number };

export interface MapEditorPaletteEntry {
  id?: string | number;
  label: string;
  color?: string;
  active?: boolean;
  disabled?: boolean;
}

export interface MapEditorCellDetails {
  x: number;
  y: number;
  idx: number;
  cell: number;
  roomId: number;
  zoneId: number;
  wallTex: number;
  floorTex: number;
  feature: number;
  doorState?: number;
  liftDir?: number;
  protected?: boolean;
  containerCount: number;
  entityCount: number;
}

export interface MapEditorSnapshotLike {
  floorKey?: string;
  floorLabel?: string;
  z?: number | string;
  tool?: MapEditorToolId;
  brush?: string | number;
  brushLabel?: string;
  mode?: string;
  status?: string;
  error?: string;
  dirtyOps?: number;
  opCount?: number;
  patchOps?: number;
  maxPatchOps?: number;
  cursorX?: number;
  cursorY?: number;
  cameraX?: number;
  cameraY?: number;
  zoom?: number;
  revision?: number | string;
  mapRevision?: number | string;
  thumbnailKey?: string | number;
  thumbnailRevision?: number | string;
  thumbnailDirty?: boolean;
  dirtyCells?: readonly MapEditorDirtyCell[];
  selectedCell?: Partial<MapEditorCellDetails>;
  tools?: readonly (MapEditorToolId | MapEditorPaletteEntry)[];
  palette?: readonly (string | MapEditorPaletteEntry)[];
  menuTitle?: string;
  menuIndex?: number;
  menuEntries?: readonly MapEditorPaletteEntry[];
  hints?: readonly string[];
  terminals?: readonly { x: number; y: number; active?: boolean }[];
  activeTerminalX?: number;
  activeTerminalY?: number;
  entityCap?: number;
  showGrid?: boolean;
}

interface ThumbnailCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  world: World | null;
  baseSignature: string;
  revisionSignature: string;
}

interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
  pad: number;
  gap: number;
  headerH: number;
  bottomH: number;
  leftW: number;
  rightW: number;
  mapX: number;
  mapY: number;
  mapW: number;
  mapH: number;
}

const WORLD_CELLS = W * W;
const DEFAULT_TOOLS: readonly MapEditorPaletteEntry[] = [
  { id: 'cell', label: 'КЛЕТ', color: '#8cf' },
  { id: 'door', label: 'ДВЕР', color: '#d98' },
  { id: 'texture', label: 'ТЕКС', color: '#bc8' },
  { id: 'feature', label: 'ФИЧА', color: '#fd8' },
  { id: 'entity', label: 'ЭНТ', color: '#e88' },
  { id: 'container', label: 'ЯЩИК', color: '#db6' },
  { id: 'inspect', label: 'ИНСП', color: '#9df' },
];

const DEFAULT_CELL_PALETTE: readonly MapEditorPaletteEntry[] = [
  { id: Cell.FLOOR, label: 'FLOOR', color: '#6d7480' },
  { id: Cell.WALL, label: 'WALL', color: '#2b3036' },
  { id: Cell.DOOR, label: 'DOOR', color: '#a67646' },
  { id: Cell.WATER, label: 'WATER', color: '#286b8c' },
  { id: Cell.ABYSS, label: 'GLITCH', color: '#100812' },
  { id: Cell.LIFT, label: 'LIFT', color: '#d4cb3c' },
];

const DEFAULT_DOOR_PALETTE: readonly MapEditorPaletteEntry[] = [
  { id: DoorState.OPEN, label: 'OPEN', color: '#8d7' },
  { id: DoorState.CLOSED, label: 'CLOSED', color: '#b85' },
  { id: DoorState.LOCKED, label: 'LOCKED', color: '#f76' },
  { id: DoorState.HERMETIC_OPEN, label: 'HERM ОТКР', color: '#8cf' },
  { id: DoorState.HERMETIC_CLOSED, label: 'HERM ЗАКР', color: '#6ec3ff' },
];

const DEFAULT_FEATURE_PALETTE: readonly MapEditorPaletteEntry[] = [
  { id: Feature.NONE, label: 'NONE', color: '#789' },
  { id: Feature.LAMP, label: 'LAMP', color: '#ffe088' },
  { id: Feature.TABLE, label: 'TABLE', color: '#b98' },
  { id: Feature.CHAIR, label: 'CHAIR', color: '#ba9' },
  { id: Feature.BED, label: 'BED', color: '#99a' },
  { id: Feature.SHELF, label: 'SHELF', color: '#caa' },
  { id: Feature.MACHINE, label: 'MACH', color: '#9d9' },
  { id: Feature.APPARATUS, label: 'APPAR', color: '#7fa' },
  { id: Feature.SCREEN, label: 'SCREEN', color: '#63f6ff' },
];

let thumbnailCache: ThumbnailCache | null = null;
const pendingDirtyCells = new WeakMap<World, Set<number>>();
const zoneRgb: number[] = [];

for (let i = 0; i < 64; i++) zoneRgb.push(makeZoneRgb(i));

function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function blendRgb(rgb: number, r: number, g: number, b: number, a: number): number {
  const ia = 1 - a;
  const br = (rgb >> 16) & 255;
  const bg = (rgb >> 8) & 255;
  const bb = rgb & 255;
  return packRgb(
    Math.round(br * ia + r * a),
    Math.round(bg * ia + g * a),
    Math.round(bb * ia + b * a),
  );
}

function makeZoneRgb(i: number): number {
  const hue = (i * 137.508) % 360;
  const sat = 0.35 + (i % 3) * 0.15;
  const lit = 0.25 + (i % 4) * 0.06;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; }
  else if (hue < 120) { r1 = x; g1 = c; }
  else if (hue < 180) { g1 = c; b1 = x; }
  else if (hue < 240) { g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  return packRgb(
    Math.round((r1 + m) * 128),
    Math.round((g1 + m) * 128),
    Math.round((b1 + m) * 128),
  );
}

function roomRgb(type: RoomType | undefined): number {
  switch (type) {
    case RoomType.LIVING: return packRgb(68, 68, 102);
    case RoomType.KITCHEN: return packRgb(85, 85, 68);
    case RoomType.BATHROOM: return packRgb(68, 85, 85);
    case RoomType.STORAGE: return packRgb(85, 68, 51);
    case RoomType.MEDICAL: return packRgb(68, 102, 102);
    case RoomType.PRODUCTION: return packRgb(85, 85, 68);
    case RoomType.OFFICE: return packRgb(74, 72, 92);
    case RoomType.HQ: return packRgb(86, 72, 96);
    case RoomType.CORRIDOR: return packRgb(50, 54, 58);
    default: return packRgb(51, 51, 51);
  }
}

function normalizeIndex(idx: number): number {
  const value = Math.floor(idx);
  return ((value % WORLD_CELLS) + WORLD_CELLS) % WORLD_CELLS;
}

function dirtyCellIndex(world: World, cell: MapEditorDirtyCell): number {
  if (typeof cell === 'number') return normalizeIndex(cell);
  if (cell.idx !== undefined) return normalizeIndex(cell.idx);
  return world.idx(Math.floor(cell.x), Math.floor(cell.y));
}

function cellRgb(world: World, idx: number): number {
  const cell = world.cells[idx];
  if (cell === Cell.WALL) {
    if (world.hermoWall[idx]) return packRgb(70, 138, 180);
    return world.aptMask[idx] ? packRgb(45, 43, 50) : packRgb(22, 25, 30);
  }
  if (cell === Cell.ABYSS) return packRgb(10, 5, 14);
  if (cell === Cell.LIFT) return packRgb(204, 196, 42);
  if (cell === Cell.WATER) return packRgb(35, 72, 92);
  if (cell === Cell.DOOR) {
    const door = world.doors.get(idx);
    if (door?.state === DoorState.LOCKED) return packRgb(190, 78, 62);
    if (door?.state === DoorState.HERMETIC_CLOSED || door?.state === DoorState.HERMETIC_OPEN) return packRgb(94, 172, 210);
    if (door?.state === DoorState.OPEN) return packRgb(108, 138, 90);
    return packRgb(136, 100, 68);
  }

  const rid = world.roomMap[idx];
  let rgb = rid >= 0 ? roomRgb(world.rooms[rid]?.type) : zoneRgb[world.zoneMap[idx] % 64];
  const feature = world.features[idx];
  if (feature === Feature.LAMP || feature === Feature.CANDLE) rgb = blendRgb(rgb, 245, 205, 120, 0.5);
  else if (feature === Feature.SCREEN) rgb = blendRgb(rgb, 72, 220, 230, 0.45);
  else if (feature === Feature.APPARATUS || feature === Feature.MACHINE) rgb = blendRgb(rgb, 104, 196, 150, 0.35);
  else if (feature === Feature.BED || feature === Feature.TABLE || feature === Feature.SHELF) rgb = blendRgb(rgb, 180, 140, 110, 0.22);
  if (world.aptMask[idx]) rgb = blendRgb(rgb, 92, 150, 175, 0.12);
  if (world.fog[idx] > 0) rgb = blendRgb(rgb, 82, 24, 116, Math.min(0.65, world.fog[idx] / 330));
  return rgb;
}

function writePackedPixel(data: Uint8ClampedArray, idx: number, rgb: number): void {
  const di = idx * 4;
  data[di] = (rgb >> 16) & 255;
  data[di + 1] = (rgb >> 8) & 255;
  data[di + 2] = rgb & 255;
  data[di + 3] = 255;
}

function writeCellPixel(cache: ThumbnailCache, world: World, idx: number): void {
  writePackedPixel(cache.image.data, idx, cellRgb(world, idx));
}

function createThumbnailCache(): ThumbnailCache {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const imageCtx = canvas.getContext('2d', { alpha: false })!;
  return {
    canvas,
    ctx: imageCtx,
    image: imageCtx.createImageData(W, W),
    world: null,
    baseSignature: '',
    revisionSignature: '',
  };
}

function baseSignature(world: World, state: MapEditorSnapshotLike): string {
  const key = state.thumbnailKey ?? state.floorKey ?? '';
  return [
    key,
    world.fogVersion,
    world.wallTexVersion,
    world.floorTexVersion,
    world.surfaceVersion,
  ].join(':');
}

function revisionSignature(base: string, state: MapEditorSnapshotLike): string {
  const revision = state.thumbnailRevision
    ?? state.mapRevision
    ?? state.revision
    ?? state.dirtyOps
    ?? state.opCount
    ?? 0;
  return `${base}:${revision}`;
}

function buildThumbnail(cache: ThumbnailCache, world: World): void {
  const data = cache.image.data;
  for (let idx = 0; idx < WORLD_CELLS; idx++) writePackedPixel(data, idx, cellRgb(world, idx));
  for (const container of world.containers) {
    const idx = world.idx(container.x, container.y);
    writePackedPixel(data, idx, packRgb(214, 172, 74));
  }
  cache.ctx.putImageData(cache.image, 0, 0);
}

function collectDirtyCells(world: World, state: MapEditorSnapshotLike): number[] {
  const out: number[] = [];
  const pending = pendingDirtyCells.get(world);
  if (pending) {
    for (const idx of pending) out.push(idx);
    pending.clear();
  }
  if (state.dirtyCells) {
    for (const cell of state.dirtyCells) out.push(dirtyCellIndex(world, cell));
  }
  return out;
}

function updateDirtyPixels(cache: ThumbnailCache, world: World, dirty: readonly number[]): void {
  if (dirty.length === 0) return;
  for (const idx of dirty) writeCellPixel(cache, world, normalizeIndex(idx));
  cache.ctx.putImageData(cache.image, 0, 0);
}

function thumbnailForWorld(world: World, state: MapEditorSnapshotLike): HTMLCanvasElement {
  const cache = thumbnailCache ??= createThumbnailCache();
  const base = baseSignature(world, state);
  const revision = revisionSignature(base, state);
  const dirty = collectDirtyCells(world, state);
  const needsFullBuild = cache.world !== world
    || cache.baseSignature !== base
    || state.thumbnailDirty === true
    || (cache.revisionSignature !== revision && dirty.length === 0);

  if (needsFullBuild) {
    buildThumbnail(cache, world);
  } else {
    updateDirtyPixels(cache, world, dirty);
  }

  cache.world = world;
  cache.baseSignature = base;
  cache.revisionSignature = revision;
  return cache.canvas;
}

export function invalidateMapEditorThumbnail(world?: World): void {
  if (!thumbnailCache) return;
  if (!world || thumbnailCache.world === world) {
    thumbnailCache.world = null;
    thumbnailCache.baseSignature = '';
    thumbnailCache.revisionSignature = '';
  }
}

export function markMapEditorThumbnailDirty(world: World, cells: readonly MapEditorDirtyCell[]): void {
  let dirty = pendingDirtyCells.get(world);
  if (!dirty) {
    dirty = new Set<number>();
    pendingDirtyCells.set(world, dirty);
  }
  for (const cell of cells) dirty.add(dirtyCellIndex(world, cell));
}

function layoutFor(ctx: CanvasRenderingContext2D, s: number): Layout {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const pad = 5 * s;
  const gap = 5 * s;
  const x = pad;
  const y = pad;
  const w = Math.max(1, cw - pad * 2);
  const h = Math.max(1, ch - pad * 2);
  const headerH = 25 * s;
  const bottomH = 19 * s;
  let leftW = Math.min(92 * s, Math.max(64 * s, w * 0.17));
  let rightW = Math.min(136 * s, Math.max(86 * s, w * 0.22));
  if (w < 420 * s) {
    leftW = Math.min(70 * s, w * 0.24);
    rightW = 0;
  }
  const mapX = x + leftW + gap;
  const mapY = y + headerH + gap;
  const mapW = Math.max(24 * s, w - leftW - rightW - gap * (rightW > 0 ? 2 : 1));
  const mapH = Math.max(24 * s, h - headerH - bottomH - gap * 2);
  return { x, y, w, h, pad, gap, headerH, bottomH, leftW, rightW, mapX, mapY, mapW, mapH };
}

function toEntry(value: MapEditorToolId | MapEditorPaletteEntry): MapEditorPaletteEntry {
  if (typeof value === 'string') return { id: value, label: value };
  return value;
}

function paletteEntry(value: string | MapEditorPaletteEntry): MapEditorPaletteEntry {
  if (typeof value === 'string') return { id: value, label: value };
  return value;
}

function defaultPaletteForTool(tool: string): readonly MapEditorPaletteEntry[] {
  if (tool === 'door') return DEFAULT_DOOR_PALETTE;
  if (tool === 'feature') return DEFAULT_FEATURE_PALETTE;
  if (tool === 'texture') return [
    { id: 'wallTex', label: 'WALL TEX', color: '#9cb' },
    { id: 'floorTex', label: 'FLOOR TEX', color: '#bc9' },
  ];
  if (tool === 'entity') return [
    { id: 'npc', label: 'NPC', color: '#59d46b' },
    { id: 'monster', label: 'MONSTER', color: '#e44' },
    { id: 'item', label: 'ITEM', color: '#dd4' },
    { id: 'delete', label: 'DELETE', color: '#f76' },
  ];
  if (tool === 'container') return [
    { id: 'wood', label: 'WOOD', color: '#c99454' },
    { id: 'metal', label: 'METAL', color: '#9aa' },
    { id: 'safe', label: 'SAFE', color: '#fc6' },
    { id: 'delete', label: 'DELETE', color: '#f76' },
  ];
  return DEFAULT_CELL_PALETTE;
}

function entryIdText(entry: MapEditorPaletteEntry): string {
  return entry.id === undefined ? entry.label : String(entry.id);
}

function activeEntryIndex(entries: readonly MapEditorPaletteEntry[], activeId = ''): number {
  const byFlag = entries.findIndex(entry => entry.active === true);
  if (byFlag >= 0) return byFlag;
  if (!activeId) return 0;
  const byId = entries.findIndex(entry => entryIdText(entry) === activeId);
  return byId >= 0 ? byId : 0;
}

function scrollStartFor(active: number, visible: number, total: number): number {
  if (visible >= total) return 0;
  return Math.max(0, Math.min(total - visible, active - Math.floor(visible * 0.5)));
}

function drawToolStrip(ctx: CanvasRenderingContext2D, layout: Layout, state: MapEditorSnapshotLike, s: number): void {
  const tools = (state.tools ?? DEFAULT_TOOLS).map(toEntry);
  const activeTool = state.tool ?? 'cell';
  const x = layout.x + layout.pad;
  let y = layout.y + layout.headerH + layout.gap + 2 * s;
  const w = Math.max(1, layout.leftW - layout.pad * 1.4);
  const rowH = 16 * s;

  ctx.font = `${7 * s}px monospace`;
  ctx.fillStyle = '#607080';
  ctx.fillText('ИНСТРУМЕНТ', x, y - 10 * s);
  for (const tool of tools) {
    const active = tool.active === true || entryIdText(tool) === activeTool;
    ctx.fillStyle = active ? 'rgba(80,220,230,0.20)' : 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, y, w, rowH - 2 * s);
    ctx.strokeStyle = active ? 'rgba(99,246,255,0.75)' : 'rgba(80,110,120,0.28)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, rowH - 2 * s - 1);
    ctx.fillStyle = tool.disabled ? '#46545c' : active ? (tool.color ?? '#63f6ff') : '#7f9298';
    ctx.fillText(fitText(ctx, tool.label, w - 6 * s), x + 3 * s, y + 4 * s);
    y += rowH;
    if (y > layout.y + layout.h - layout.bottomH - rowH) break;
  }
}

function drawPalette(ctx: CanvasRenderingContext2D, layout: Layout, state: MapEditorSnapshotLike, s: number): void {
  if (layout.rightW <= 0) return;
  const activeTool = state.tool ?? 'cell';
  const entries = (state.palette ?? defaultPaletteForTool(activeTool)).map(paletteEntry);
  const brush = state.brush === undefined ? '' : String(state.brush);
  const x = layout.mapX + layout.mapW + layout.gap;
  let y = layout.y + layout.headerH + layout.gap + 2 * s;
  const w = Math.max(1, layout.rightW - layout.pad);
  const rowH = 15 * s;
  const maxY = layout.y + layout.h - layout.bottomH - rowH;
  const visibleRows = Math.max(1, Math.floor((maxY - y) / rowH) + 1);
  const activeIdx = activeEntryIndex(entries, brush);
  const start = scrollStartFor(activeIdx, visibleRows, entries.length);
  const end = Math.min(entries.length, start + visibleRows);

  ctx.font = `${7 * s}px monospace`;
  ctx.fillStyle = '#607080';
  ctx.fillText('ПАЛИТРА', x, y - 10 * s);
  for (let i = start; i < end; i++) {
    const entry = entries[i];
    const id = entryIdText(entry);
    const active = entry.active === true || (brush !== '' && id === brush);
    ctx.fillStyle = active ? 'rgba(80,220,180,0.18)' : 'rgba(0,0,0,0.24)';
    ctx.fillRect(x, y, w, rowH - 2 * s);
    ctx.strokeStyle = active ? 'rgba(120,255,200,0.65)' : 'rgba(80,110,120,0.22)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, rowH - 2 * s - 1);
    ctx.fillStyle = entry.color ?? (active ? '#9fdbc6' : '#7f9298');
    ctx.fillRect(x + 3 * s, y + 4 * s, 5 * s, 5 * s);
    ctx.fillStyle = entry.disabled ? '#46545c' : active ? '#dff' : '#93a4aa';
    ctx.fillText(fitText(ctx, entry.label, w - 14 * s), x + 11 * s, y + 3 * s);
    y += rowH;
  }
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawMapTiles(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  layout: Layout,
  centerX: number,
  centerY: number,
  scale: number,
): void {
  const tile = W * scale;
  const ox = layout.mapX + layout.mapW * 0.5 - centerX * scale;
  const oy = layout.mapY + layout.mapH * 0.5 - centerY * scale;
  const startX = Math.floor((layout.mapX - ox) / tile) - 1;
  const endX = Math.ceil((layout.mapX + layout.mapW - ox) / tile) + 1;
  const startY = Math.floor((layout.mapY - oy) / tile) - 1;
  const endY = Math.ceil((layout.mapY + layout.mapH - oy) / tile) + 1;

  for (let ty = startY; ty <= endY; ty++) {
    for (let tx = startX; tx <= endX; tx++) {
      ctx.drawImage(image, ox + tx * tile, oy + ty * tile, tile, tile);
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, layout: Layout, centerX: number, centerY: number, scale: number): void {
  if (scale < 9) return;
  const startX = Math.floor(centerX - layout.mapW / (2 * scale)) - 1;
  const endX = Math.ceil(centerX + layout.mapW / (2 * scale)) + 1;
  const startY = Math.floor(centerY - layout.mapH / (2 * scale)) - 1;
  const endY = Math.ceil(centerY + layout.mapH / (2 * scale)) + 1;
  ctx.strokeStyle = 'rgba(120,180,190,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= endX; x++) {
    const sx = layout.mapX + layout.mapW * 0.5 + (x - centerX) * scale;
    ctx.moveTo(sx, layout.mapY);
    ctx.lineTo(sx, layout.mapY + layout.mapH);
  }
  for (let y = startY; y <= endY; y++) {
    const sy = layout.mapY + layout.mapH * 0.5 + (y - centerY) * scale;
    ctx.moveTo(layout.mapX, sy);
    ctx.lineTo(layout.mapX + layout.mapW, sy);
  }
  ctx.stroke();
}

function screenX(layout: Layout, world: World, centerX: number, x: number, scale: number): number {
  return layout.mapX + layout.mapW * 0.5 + world.delta(centerX, x) * scale;
}

function screenY(layout: Layout, world: World, centerY: number, y: number, scale: number): number {
  return layout.mapY + layout.mapH * 0.5 + world.delta(centerY, y) * scale;
}

function drawPlayerMarker(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  world: World,
  player: Entity,
  centerX: number,
  centerY: number,
  scale: number,
): void {
  const x = screenX(layout, world, centerX, player.x, scale);
  const y = screenY(layout, world, centerY, player.y, scale);
  if (x < layout.mapX - 8 || x > layout.mapX + layout.mapW + 8 || y < layout.mapY - 8 || y > layout.mapY + layout.mapH + 8) return;
  const r = Math.max(3, Math.min(8, scale * 0.9));
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#001018';
  ctx.lineWidth = Math.max(1, sFloor(scale * 0.18));
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(player.angle) * r * 2.2, y + Math.sin(player.angle) * r * 2.2);
  ctx.stroke();
}

function sFloor(value: number): number {
  return Math.floor(value);
}

function entityColor(entity: Entity): string {
  if (entity.type === EntityType.NPC) return '#59d46b';
  if (entity.type === EntityType.MONSTER) return '#e44';
  if (entity.type === EntityType.ITEM_DROP) return '#dd4';
  if (entity.type === EntityType.BILLBOARD) return '#8a8';
  if (entity.type === EntityType.PROJECTILE) return '#8cf';
  return '#fff';
}

function drawEntityDots(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  world: World,
  entities: readonly Entity[],
  centerX: number,
  centerY: number,
  scale: number,
  cap: number,
): void {
  let drawn = 0;
  const r = Math.max(1.4, Math.min(4, scale * 0.45));
  for (const entity of entities) {
    if (!entity.alive || isPlayerEntity(entity)) continue;
    const x = screenX(layout, world, centerX, entity.x, scale);
    const y = screenY(layout, world, centerY, entity.y, scale);
    if (x < layout.mapX - 4 || x > layout.mapX + layout.mapW + 4 || y < layout.mapY - 4 || y > layout.mapY + layout.mapH + 4) continue;
    ctx.fillStyle = entityColor(entity);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    drawn++;
    if (drawn >= cap) break;
  }
}

function drawTerminalMarkers(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  world: World,
  state: MapEditorSnapshotLike,
  centerX: number,
  centerY: number,
  scale: number,
  time: number,
): void {
  const terminals = state.terminals ?? [];
  const pulse = 0.55 + Math.sin(time * 5) * 0.25;
  ctx.lineWidth = Math.max(1, Math.min(3, scale * 0.28));
  for (const terminal of terminals) {
    const x = screenX(layout, world, centerX, terminal.x + 0.5, scale);
    const y = screenY(layout, world, centerY, terminal.y + 0.5, scale);
    if (x < layout.mapX - 8 || x > layout.mapX + layout.mapW + 8 || y < layout.mapY - 8 || y > layout.mapY + layout.mapH + 8) continue;
    const active = terminal.active || (
      state.activeTerminalX !== undefined &&
      state.activeTerminalY !== undefined &&
      world.idx(terminal.x, terminal.y) === world.idx(state.activeTerminalX, state.activeTerminalY)
    );
    const r = active ? 6 + pulse * 3 : 4;
    ctx.strokeStyle = active ? '#ff5868' : '#63f6ff';
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 1.5, y);
    ctx.lineTo(x + r * 1.5, y);
    ctx.moveTo(x, y - r * 1.5);
    ctx.lineTo(x, y + r * 1.5);
    ctx.stroke();
  }
}

function drawCursorMarker(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  world: World,
  cursorX: number,
  cursorY: number,
  centerX: number,
  centerY: number,
  scale: number,
): void {
  const x = screenX(layout, world, centerX, cursorX + 0.5, scale);
  const y = screenY(layout, world, centerY, cursorY + 0.5, scale);
  const size = Math.max(5, Math.min(18, scale));
  ctx.strokeStyle = '#63f6ff';
  ctx.lineWidth = Math.max(1, Math.min(3, scale * 0.2));
  ctx.strokeRect(x - size * 0.5, y - size * 0.5, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.moveTo(x - size * 0.75, y);
  ctx.lineTo(x + size * 0.75, y);
  ctx.moveTo(x, y - size * 0.75);
  ctx.lineTo(x, y + size * 0.75);
  ctx.stroke();
}

function drawMapViewport(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  world: World,
  entities: readonly Entity[],
  player: Entity,
  state: MapEditorSnapshotLike,
  s: number,
  time: number,
): void {
  const image = thumbnailForWorld(world, state);
  const cursorX = world.wrap(Math.floor(finiteNumber(state.cursorX, player.x)));
  const cursorY = world.wrap(Math.floor(finiteNumber(state.cursorY, player.y)));
  const centerX = world.wrap(finiteNumber(state.cameraX, cursorX + 0.5));
  const centerY = world.wrap(finiteNumber(state.cameraY, cursorY + 0.5));
  const baseScale = Math.min(layout.mapW / W, layout.mapH / W);
  const zoom = clamp(finiteNumber(state.zoom, 1), 0.5, 64);
  const scale = Math.max(0.15, baseScale * zoom);

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.mapX, layout.mapY, layout.mapW, layout.mapH);
  ctx.clip();
  ctx.fillStyle = '#02070b';
  ctx.fillRect(layout.mapX, layout.mapY, layout.mapW, layout.mapH);
  ctx.imageSmoothingEnabled = false;
  drawMapTiles(ctx, image, layout, centerX, centerY, scale);
  if (state.showGrid !== false) drawGrid(ctx, layout, centerX, centerY, scale);
  drawTerminalMarkers(ctx, layout, world, state, centerX, centerY, scale, time);
  drawEntityDots(ctx, layout, world, entities, centerX, centerY, scale, Math.max(0, Math.floor(state.entityCap ?? 900)));
  drawPlayerMarker(ctx, layout, world, player, centerX, centerY, scale);
  drawCursorMarker(ctx, layout, world, cursorX, cursorY, centerX, centerY, scale);
  ctx.restore();

  ctx.strokeStyle = 'rgba(99,246,255,0.42)';
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeRect(layout.mapX + 0.5, layout.mapY + 0.5, layout.mapW - 1, layout.mapH - 1);
}

function cellName(cell: number): string {
  switch (cell) {
    case Cell.FLOOR: return 'FLOOR';
    case Cell.WALL: return 'WALL';
    case Cell.DOOR: return 'DOOR';
    case Cell.ABYSS: return 'GLITCH';
    case Cell.LIFT: return 'LIFT';
    case Cell.WATER: return 'WATER';
    default: return String(cell);
  }
}

function featureName(feature: number): string {
  switch (feature) {
    case Feature.NONE: return 'NONE';
    case Feature.LAMP: return 'LAMP';
    case Feature.TABLE: return 'TABLE';
    case Feature.CHAIR: return 'CHAIR';
    case Feature.BED: return 'BED';
    case Feature.STOVE: return 'STOVE';
    case Feature.SINK: return 'SINK';
    case Feature.TOILET: return 'TOILET';
    case Feature.SHELF: return 'SHELF';
    case Feature.MACHINE: return 'MACHINE';
    case Feature.APPARATUS: return 'APPARATUS';
    case Feature.LIFT_BUTTON: return 'LIFT_BUTTON';
    case Feature.DESK: return 'DESK';
    case Feature.SLIDE: return 'SLIDE';
    case Feature.CANDLE: return 'CANDLE';
    case Feature.SCREEN: return 'SCREEN';
    default: return String(feature);
  }
}

function doorName(doorState: number | undefined): string {
  switch (doorState) {
    case DoorState.OPEN: return 'OPEN';
    case DoorState.CLOSED: return 'CLOSED';
    case DoorState.LOCKED: return 'LOCKED';
    case DoorState.HERMETIC_OPEN: return 'HERMETIC_OPEN';
    case DoorState.HERMETIC_CLOSED: return 'HERMETIC_CLOSED';
    default: return '-';
  }
}

function liftName(liftDir: number | undefined): string {
  if (liftDir === LiftDirection.UP) return 'UP';
  if (liftDir === LiftDirection.DOWN) return 'DOWN';
  return '-';
}

function inspectCell(
  world: World,
  entities: readonly Entity[],
  x: number,
  y: number,
  selected?: Partial<MapEditorCellDetails>,
): MapEditorCellDetails {
  const idx = world.idx(x, y);
  let entityCount = 0;
  for (const entity of entities) {
    if (!entity.alive) continue;
    if (world.idx(Math.floor(entity.x), Math.floor(entity.y)) === idx) entityCount++;
  }
  const door = world.doors.get(idx);
  const details: MapEditorCellDetails = {
    x: world.wrap(x),
    y: world.wrap(y),
    idx,
    cell: world.cells[idx],
    roomId: world.roomMap[idx],
    zoneId: world.zoneMap[idx],
    wallTex: world.wallTex[idx],
    floorTex: world.floorTex[idx],
    feature: world.features[idx],
    doorState: door?.state,
    liftDir: world.cells[idx] === Cell.LIFT ? world.liftDir[idx] : undefined,
    protected: world.aptMask[idx] !== 0 || world.hermoWall[idx] !== 0,
    containerCount: world.containerMap.get(idx)?.length ?? 0,
    entityCount,
  };
  return { ...details, ...selected };
}

function drawLabelValue(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  s: number,
  color = '#9fb8bd',
): void {
  const split = Math.min(52 * s, w * 0.43);
  ctx.fillStyle = '#607080';
  ctx.fillText(fitText(ctx, label, split - 2 * s), x, y);
  ctx.fillStyle = color;
  ctx.fillText(fitText(ctx, value, w - split), x + split, y);
}

function drawInspector(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  world: World,
  entities: readonly Entity[],
  player: Entity,
  state: MapEditorSnapshotLike,
  s: number,
): void {
  const cursorX = world.wrap(Math.floor(finiteNumber(state.cursorX, player.x)));
  const cursorY = world.wrap(Math.floor(finiteNumber(state.cursorY, player.y)));
  const details = inspectCell(world, entities, cursorX, cursorY, state.selectedCell);
  const x = layout.x + layout.pad;
  const w = Math.max(1, layout.leftW - layout.pad * 1.4);
  let y = layout.y + layout.h - layout.bottomH - 82 * s;
  const lineH = 9 * s;

  ctx.font = `${7 * s}px monospace`;
  ctx.fillStyle = '#607080';
  ctx.fillText('ИНСПЕКТОР', x, y);
  y += 10 * s;
  drawLabelValue(ctx, 'xy', `${details.x},${details.y}`, x, y, w, s, '#dff'); y += lineH;
  drawLabelValue(ctx, 'idx', String(details.idx), x, y, w, s); y += lineH;
  drawLabelValue(ctx, 'cell', cellName(details.cell), x, y, w, s, details.protected ? '#6ec3ff' : '#d8d0bd'); y += lineH;
  drawLabelValue(ctx, 'room', String(details.roomId), x, y, w, s); y += lineH;
  drawLabelValue(ctx, 'zone', String(details.zoneId), x, y, w, s); y += lineH;
  drawLabelValue(ctx, 'tex', `${details.wallTex}/${details.floorTex}`, x, y, w, s); y += lineH;
  drawLabelValue(ctx, 'feat', featureName(details.feature), x, y, w, s, '#fd8'); y += lineH;
  if (details.doorState !== undefined) {
    drawLabelValue(ctx, 'door', doorName(details.doorState), x, y, w, s, '#d98');
    y += lineH;
  } else if (details.liftDir !== undefined) {
    drawLabelValue(ctx, 'lift', liftName(details.liftDir), x, y, w, s, '#dd4');
    y += lineH;
  }
  drawLabelValue(ctx, 'obj', `${details.containerCount}/${details.entityCount}`, x, y, w, s, '#db6');
}

function drawModePanel(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  state: MapEditorSnapshotLike,
  s: number,
  time: number,
): void {
  const mode = state.mode ?? 'map';
  if (mode === 'map') return;
  const entries = state.menuEntries ?? [];
  const rows = mode === 'details' ? 4 : Math.max(1, Math.min(12, entries.length));
  const panelW = Math.min(layout.mapW - 12 * s, 190 * s);
  const panelH = Math.min(layout.mapH - 12 * s, (28 + rows * 16) * s);
  const x = layout.mapX + (layout.mapW - panelW) * 0.5;
  const y = layout.mapY + Math.max(8 * s, (layout.mapH - panelH) * 0.5);
  const pad = 8 * s;

  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1250);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, 0.014);
  drawGlitchText(ctx, state.menuTitle ?? String(mode).toUpperCase(), x + pad, y + 8 * s, time, 1251, '#63f6ff', 9 * s);

  ctx.font = `${7 * s}px monospace`;
  if (mode === 'details') {
    const lines = [
      `xy ${Math.floor(Number(state.cursorX ?? 0))},${Math.floor(Number(state.cursorY ?? 0))}`,
      `floor ${state.floorLabel ?? state.floorKey ?? '-'}`,
      `tool ${state.tool ?? '-'} / ${state.brushLabel ?? '-'}`,
      `ops ${state.patchOps ?? state.dirtyOps ?? 0}/${state.maxPatchOps ?? '-'}`,
    ];
    let ly = y + 27 * s;
    for (const line of lines) {
      ctx.fillStyle = '#9fb8bd';
      ctx.fillText(fitText(ctx, line, panelW - pad * 2), x + pad, ly);
      ly += 14 * s;
    }
    return;
  }

  let ly = y + 27 * s;
  const activeIndex = Math.max(0, Math.floor(state.menuIndex ?? 0));
  const rowH = 16 * s;
  const visibleRows = Math.max(1, Math.floor((y + panelH - ly - 4 * s) / rowH));
  const paletteActive = activeEntryIndex(entries);
  const activeForScroll = mode === 'menu' ? activeIndex : paletteActive;
  const start = scrollStartFor(activeForScroll, visibleRows, entries.length);
  const end = Math.min(entries.length, start + visibleRows);
  for (let i = start; i < end; i++) {
    const entry = entries[i];
    const active = entry.active === true || (mode === 'menu' && i === activeIndex);
    ctx.fillStyle = active ? 'rgba(99,246,255,0.18)' : 'rgba(0,0,0,0.30)';
    ctx.fillRect(x + pad, ly - 2 * s, panelW - pad * 2, 13 * s);
    ctx.strokeStyle = active ? 'rgba(99,246,255,0.72)' : 'rgba(90,120,130,0.25)';
    ctx.strokeRect(x + pad + 0.5, ly - 2 * s + 0.5, panelW - pad * 2 - 1, 13 * s - 1);
    ctx.fillStyle = active ? (entry.color ?? '#dff') : '#8aa0a6';
    ctx.fillText(fitText(ctx, `${active ? '>' : ' '} ${entry.label}`, panelW - pad * 2 - 4 * s), x + pad + 3 * s, ly + 1 * s);
    ly += rowH;
  }
}

function statusParts(state: MapEditorSnapshotLike): string[] {
  const floor = state.floorLabel ?? state.floorKey ?? 'текущий этаж';
  const z = state.z === undefined ? '' : `z:${state.z}`;
  const tool = state.tool ?? 'cell';
  const brush = state.brushLabel ?? (state.brush === undefined ? '-' : String(state.brush));
  const ops = state.dirtyOps ?? state.opCount ?? state.patchOps ?? 0;
  const cap = state.maxPatchOps === undefined ? '' : `/${state.maxPatchOps}`;
  return [floor, z, `tool:${tool}`, `brush:${brush}`, `ops:${ops}${cap}`].filter(Boolean);
}

function drawStatus(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  state: MapEditorSnapshotLike,
  cursorX: number,
  cursorY: number,
  s: number,
): void {
  const x = layout.x + layout.pad;
  const y = layout.y + layout.h - layout.bottomH + 5 * s;
  const w = layout.w - layout.pad * 2;
  ctx.font = `${7 * s}px monospace`;
  const status = state.error
    ? state.error
    : state.status
    ?? `${statusParts(state).join('  |  ')}  |  xy:${cursorX},${cursorY}`;
  ctx.fillStyle = state.error ? '#ff5868' : '#668090';
  ctx.fillText(fitText(ctx, status, w), x, y);

  const hints = state.hints && state.hints.length > 0
    ? state.hints.join('  |  ')
    : `${menuCloseHint()} закрыть  |  WASD/стрелки карта  |  wheel масштаб`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#4f6470';
  ctx.fillText(fitText(ctx, hints, w * 0.48), layout.x + layout.w - layout.pad, y);
  ctx.textAlign = 'left';
}

export function drawMapEditor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  world: World,
  entities: readonly Entity[],
  player: Entity,
  state: MapEditorSnapshotLike = {},
): void {
  const s = Math.max(0.8, Math.min(2, Math.min(sx, sy)));
  const layout = layoutFor(ctx, s);
  const cursorX = world.wrap(Math.floor(finiteNumber(state.cursorX, player.x)));
  const cursorY = world.wrap(Math.floor(finiteNumber(state.cursorY, player.y)));

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,4,0.86)';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawNeuroPanel(ctx, layout.x, layout.y, layout.w, layout.h, time, 1230);
  drawStaticNoise(ctx, layout.x, layout.y, layout.w, layout.h, time, 0.018);

  ctx.textBaseline = 'top';
  drawGlitchText(ctx, 'НЕТ-ТЕРМИНАЛ ГЕН: РЕДАКТОР КАРТЫ', layout.x + layout.pad, layout.y + 8 * s, time, 1231, '#63f6ff', 10 * s);
  ctx.font = `${7 * s}px monospace`;
  ctx.fillStyle = '#607080';
  const subtitle = state.mode ? `режим: ${state.mode}` : 'снимок этажа';
  ctx.fillText(fitText(ctx, subtitle, layout.w * 0.36), layout.x + layout.w - layout.pad - 128 * s, layout.y + 10 * s);

  drawToolStrip(ctx, layout, state, s);
  drawPalette(ctx, layout, state, s);
  drawMapViewport(ctx, layout, world, entities, player, state, s, time);
  drawModePanel(ctx, layout, state, s, time);
  drawInspector(ctx, layout, world, entities, player, state, s);
  drawStatus(ctx, layout, state, cursorX, cursorY, s);
  ctx.restore();
}
