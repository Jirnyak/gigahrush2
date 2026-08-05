import { INVENTORY_GRID_COLS, INVENTORY_GRID_ROWS } from '../data/inventory_limits';

const GRID_COLS = INVENTORY_GRID_COLS;
const GRID_ROWS = INVENTORY_GRID_ROWS;
const GRID_CELL_UNITS = 22;
const GRID_GAP_UNITS = 16;
const GRID_SCREEN_W = 0.88;
const GRID_SCREEN_H = 0.82;
const GRID_SCALE_MAX = 4;
const GRID_SCALE_TARGET_MIN = 2.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface UiRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudSafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MobileHudSafeContext {
  enabled: boolean;
  portrait: boolean;
  safeInsets?: Partial<HudSafeInsets>;
}

let mobileHudSafeContext: MobileHudSafeContext = {
  enabled: false,
  portrait: false,
};

export function setMobileHudSafeContext(next: MobileHudSafeContext): void {
  mobileHudSafeContext = {
    enabled: next.enabled,
    portrait: next.portrait,
    safeInsets: next.safeInsets,
  };
}

export function getMobileHudSafeContext(): MobileHudSafeContext {
  return mobileHudSafeContext;
}

export interface HudStackSlot extends UiRect {
  cursorY: number;
  gap: number;
  align: 'left' | 'center' | 'right';
}

export interface HudSlots {
  safe: HudSafeInsets;
  topLeftEvent: HudStackSlot;
  topCenterCritical: HudStackSlot;
  topRightNavigation: HudStackSlot;
  centerInteraction: UiRect;
  centerModal: UiRect;
  bottomVitals: UiRect;
  screenFx: UiRect;
}

export interface InventoryPanelLayout {
  scale: number;
  originX: number;
  originY: number;
  grid: UiRect & { cell: number; cols: number; rows: number };
  details: UiRect;
  prep: UiRect & { cols: number; rows: number; tileW: number; tileH: number };
  equip: UiRect;
  vitals: UiRect;
  attr: UiRect;
  close: UiRect;
  use: UiRect;
  drop: UiRect;
}

export interface FullscreenInventoryLayout {
  scale: number;
  textScale: number;
  grid: UiRect & { cell: number; cols: number; rows: number };
  details: UiRect;
  close: UiRect;
  use: UiRect;
  drop: UiRect;
  attr: UiRect;
  armor: UiRect;
}

export interface ContainerMenuGridLayout {
  scale: number;
  cell: number;
  gap: number;
  cols: number;
  rows: number;
  startX: number;
  startY: number;
  containerX: number;
  gridTotal: number;
  close: UiRect;
}

export interface TradeMenuGridLayout {
  scale: number;
  cell: number;
  sideGap: number;
  centerGap: number;
  cols: number;
  rows: number;
  gridTotal: number;
  startX: number;
  startY: number;
  playerOfferX: number;
  npcOfferX: number;
  npcX: number;
  dealX: number;
  dealY: number;
  dealW: number;
  dealH: number;
}

export interface CraftMenuLayout {
  scale: number;
  originX: number;
  originY: number;
  title: UiRect;
  list: UiRect;
  detail: UiRect;
  materials: UiRect;
  bottom: UiRect;
  close: UiRect;
  rowH: number;
  materialRowH: number;
  icon: UiRect;
}

export function dialogMenuScale(canvasW: number, canvasH: number, sx: number, sy: number): number {
  const raw = Math.min(canvasW / 320, canvasH / 200);
  return Math.max(sx, sy, clamp(raw, 1, 2.72));
}

function scaledRect(originX: number, originY: number, scale: number, x: number, y: number, w: number, h: number): UiRect {
  return { x: originX + x * scale, y: originY + y * scale, w: w * scale, h: h * scale };
}

function safeNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value!) : fallback;
}

function hudSafeInsets(
  canvasW: number,
  canvasH: number,
  sx: number,
  sy: number,
  mobileControls: boolean,
  override?: Partial<HudSafeInsets>,
): HudSafeInsets {
  const base: HudSafeInsets = {
    top: 4 * sy,
    right: 4 * sx,
    bottom: 0,
    left: 4 * sx,
  };
  if (mobileControls) {
    base.top = Math.max(base.top, Math.min(58, canvasH * 0.18));
    base.left = Math.max(base.left, Math.min(118, canvasW * 0.22));
    base.right = Math.max(base.right, Math.min(104, canvasW * 0.24));
    base.bottom = Math.max(base.bottom, Math.min(160, Math.max(104, canvasH * 0.28)));
  }
  return {
    top: safeNumber(override?.top, base.top),
    right: safeNumber(override?.right, base.right),
    bottom: safeNumber(override?.bottom, base.bottom),
    left: safeNumber(override?.left, base.left),
  };
}

function makeStackSlot(
  x: number,
  y: number,
  w: number,
  h: number,
  gap: number,
  align: HudStackSlot['align'],
): HudStackSlot {
  return { x, y, w: Math.max(0, w), h: Math.max(0, h), cursorY: y, gap, align };
}

export function createHudSlots(
  canvasW: number,
  canvasH: number,
  sx: number,
  sy: number,
  options: {
    mobileControls?: boolean;
    safeInsets?: Partial<HudSafeInsets>;
    bottomVitalsHeight?: number;
    topRightWidth?: number;
  } = {},
): HudSlots {
  const safe = hudSafeInsets(canvasW, canvasH, sx, sy, !!options.mobileControls, options.safeInsets);
  const gap = Math.max(2 * sy, 4);
  const bottomH = Math.max(16 * sy, options.bottomVitalsHeight ?? 20 * sy);
  const bottomVitalsInset = options.mobileControls
    ? Math.max(4 * sy, Math.min(14 * sy, canvasH * 0.04))
    : safe.bottom;
  const bottomY = Math.max(safe.top + 64 * sy, canvasH - bottomVitalsInset - bottomH);
  const topH = Math.max(0, bottomY - safe.top - gap);
  const usableW = Math.max(0, canvasW - safe.left - safe.right);
  const navW = Math.max(80 * sx, Math.min(usableW, options.topRightWidth ?? 176 * sx));
  const topLeftW = Math.max(48 * sx, usableW - navW - 8 * sx);
  const interactionH = Math.max(18 * sy, 1);
  const minInteractionY = safe.top + 36 * sy;
  const maxInteractionY = Math.max(minInteractionY, bottomY - interactionH - gap);
  const interactionY = clamp(Math.min(canvasH * 0.5 + 24 * sy, maxInteractionY), minInteractionY, maxInteractionY);

  return {
    safe,
    topLeftEvent: makeStackSlot(safe.left, safe.top, topLeftW, topH, gap, 'left'),
    topCenterCritical: makeStackSlot(safe.left, safe.top, usableW, topH, gap, 'center'),
    topRightNavigation: makeStackSlot(canvasW - safe.right - navW, safe.top, navW, topH, gap, 'right'),
    centerInteraction: {
      x: safe.left,
      y: interactionY,
      w: usableW,
      h: Math.max(interactionH, bottomY - interactionY - gap),
    },
    centerModal: {
      x: safe.left,
      y: safe.top,
      w: usableW,
      h: Math.max(0, bottomY - safe.top),
    },
    bottomVitals: {
      x: options.mobileControls ? safe.left : 0,
      y: bottomY,
      w: options.mobileControls ? usableW : canvasW,
      h: bottomH,
    },
    screenFx: { x: 0, y: 0, w: canvasW, h: canvasH },
  };
}

export function allocateHudSlot(
  slot: HudStackSlot,
  height: number,
  width = slot.w,
  align: HudStackSlot['align'] = slot.align,
): UiRect {
  const rectW = Math.max(0, Math.min(slot.w, width));
  const rectH = Math.max(0, height);
  const x = align === 'right'
    ? slot.x + slot.w - rectW
    : align === 'center'
      ? slot.x + (slot.w - rectW) * 0.5
      : slot.x;
  const y = slot.cursorY;
  slot.cursorY = Math.min(slot.y + slot.h, slot.cursorY + rectH + slot.gap);
  return { x, y, w: rectW, h: rectH };
}

export function inventoryPanelLayout(canvasW: number, canvasH: number): InventoryPanelLayout {
  const scale = Math.max(0.2, Math.min(4.2, Math.min(canvasW / 392, canvasH / 236)));
  const originX = Math.max(0, (canvasW - 392 * scale) * 0.5);
  const originY = Math.max(0, (canvasH - 236 * scale) * 0.5);
  const grid = scaledRect(originX, originY, scale, 8, 22, GRID_CELL_UNITS * GRID_COLS, GRID_CELL_UNITS * GRID_ROWS) as InventoryPanelLayout['grid'];
  grid.cell = 22 * scale;
  grid.cols = GRID_COLS;
  grid.rows = GRID_ROWS;
  const rightX = 8 + GRID_CELL_UNITS * GRID_COLS + 14;
  const prep = scaledRect(originX, originY, scale, rightX, 22, 186, 40) as InventoryPanelLayout['prep'];
  prep.cols = 4;
  prep.rows = 2;
  prep.tileW = prep.w / prep.cols;
  prep.tileH = prep.h / prep.rows;
  return {
    scale,
    originX,
    originY,
    grid,
    details: scaledRect(originX, originY, scale, rightX, 66, 186, 42),
    prep,
    equip: scaledRect(originX, originY, scale, rightX, 112, 186, 32),
    vitals: scaledRect(originX, originY, scale, rightX, 148, 186, 80),
    attr: scaledRect(originX, originY, scale, rightX, 148, 186, 15),
    close: scaledRect(originX, originY, scale, 310, 1, 74, 16),
    use: scaledRect(originX, originY, scale, rightX, 94, 86, 14),
    drop: scaledRect(originX, originY, scale, rightX + 92, 94, 86, 14),
  };
}

export function fullscreenInventoryLayout(canvasW: number, canvasH: number, sx: number, sy: number): FullscreenInventoryLayout {
  const base = Math.min(sx, sy);
  const fitW = canvasW / (8 + GRID_CELL_UNITS * GRID_COLS + 132);
  const fitH = canvasH / (14 + GRID_CELL_UNITS * GRID_ROWS + 8);
  const scale = Math.max(0.72, Math.min(4.2, base, fitW, fitH));
  const textScale = scale <= 1.2 ? scale : Math.max(1.05, scale * 0.72);
  const cell = GRID_CELL_UNITS * scale;
  const gridX = 8 * scale;
  const gridY = 14 * scale;
  const gridW = GRID_COLS * cell;
  const gridH = GRID_ROWS * cell;
  const stX = gridX + gridW + 12 * scale;
  const rightW = Math.max(72 * scale, canvasW - stX - 8 * scale);
  const detailsY = Math.max(8 * scale, gridY - 4 * scale);
  const detailsH = 58 * textScale;
  const actionW = Math.min(82 * textScale, rightW);
  const actionY = detailsY + 37 * textScale;
  const grid = { x: gridX, y: gridY, w: gridW, h: gridH, cell, cols: GRID_COLS, rows: GRID_ROWS };
  const armorCell = cell * 2;
  const armorX = gridX + gridW - armorCell;
  const armorY = gridY + gridH + 8 * scale;
  return {
    scale,
    textScale,
    grid,
    close: { x: canvasW - 88 * scale, y: 0, w: 88 * scale, h: 18 * scale },
    details: { x: stX, y: detailsY, w: rightW, h: detailsH },
    use: { x: stX, y: actionY, w: actionW, h: 12 * textScale },
    drop: { x: stX + actionW + 6 * textScale, y: actionY, w: actionW, h: 12 * textScale },
    attr: { x: stX, y: detailsY + detailsH + 4 * textScale, w: rightW, h: 14 * textScale },
    armor: { x: armorX, y: armorY, w: armorCell, h: armorCell },
  };
}

function inventoryGridScale(canvasW: number, canvasH: number, verticalUnits: number, horizontalUnits?: number): number {
  const raw = Math.min(canvasW / 320, canvasH / 200);
  const twoGridUnits = GRID_CELL_UNITS * GRID_COLS * 2 + GRID_GAP_UNITS;
  const byW = (canvasW * GRID_SCREEN_W) / (horizontalUnits ?? twoGridUnits);
  const byH = (canvasH * GRID_SCREEN_H) / verticalUnits;
  const fit = Math.min(raw, byW, byH);
  const minScale = Math.max(1, Math.min(GRID_SCALE_TARGET_MIN, byW, byH));
  return clamp(fit, Math.min(minScale, fit), GRID_SCALE_MAX);
}

export function tradeGridScale(canvasW: number, canvasH: number): number {
  const fourGridUnits = GRID_CELL_UNITS * GRID_COLS * 4 + GRID_GAP_UNITS * 1.9;
  return inventoryGridScale(canvasW, canvasH, 24 + GRID_CELL_UNITS * GRID_ROWS + 58, fourGridUnits);
}

export function containerGridScale(canvasW: number, canvasH: number): number {
  return inventoryGridScale(canvasW, canvasH, 30 + GRID_CELL_UNITS * GRID_ROWS + 66);
}

export function containerMenuGridLayout(canvasW: number, canvasH: number): ContainerMenuGridLayout {
  const scale = containerGridScale(canvasW, canvasH);
  const cell = GRID_CELL_UNITS * scale;
  const gap = GRID_GAP_UNITS * scale;
  const gridTotal = GRID_COLS * cell;
  const totalW = gridTotal * 2 + gap;
  const startX = (canvasW - totalW) / 2;
  const startY = 30 * scale;
  return {
    scale,
    cell,
    gap,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    startX,
    startY,
    containerX: startX + gridTotal + gap,
    gridTotal,
    close: { x: 0, y: canvasH - 30 * scale, w: canvasW, h: 30 * scale },
  };
}

export function tradeMenuGridLayout(canvasW: number, canvasH: number): TradeMenuGridLayout {
  const scale = tradeGridScale(canvasW, canvasH);
  const cell = GRID_CELL_UNITS * scale;
  const sideGap = Math.max(4 * scale, GRID_GAP_UNITS * 0.35 * scale);
  const centerGap = Math.max(6 * scale, GRID_GAP_UNITS * 0.6 * scale);
  const gridTotal = GRID_COLS * cell;
  const totalW = gridTotal * 4 + sideGap * 2 + centerGap;
  const startX = (canvasW - totalW) / 2;
  const startY = 30 * scale;
  const playerOfferX = startX + gridTotal + sideGap;
  const npcOfferX = playerOfferX + gridTotal + centerGap;
  const npcX = npcOfferX + gridTotal + sideGap;
  const dealX = playerOfferX;
  const dealY = startY + GRID_ROWS * cell + 10 * scale;
  const dealW = gridTotal * 2 + centerGap;
  const dealH = 17 * scale;
  return {
    scale,
    cell,
    sideGap,
    centerGap,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    gridTotal,
    startX,
    startY,
    playerOfferX,
    npcOfferX,
    npcX,
    dealX,
    dealY,
    dealW,
    dealH,
  };
}

export function craftMenuLayout(canvasW: number, canvasH: number): CraftMenuLayout {
  const raw = Math.min(canvasW / 320, canvasH / 200);
  const scale = Math.max(0.72, Math.min(4.2, raw));
  const baseW = 320 * scale;
  const baseH = 200 * scale;
  const originX = Math.max(0, (canvasW - baseW) * 0.5);
  const originY = Math.max(0, (canvasH - baseH) * 0.5);
  const r = (x: number, y: number, w: number, h: number): UiRect => scaledRect(originX, originY, scale, x, y, w, h);
  return {
    scale,
    originX,
    originY,
    title: r(8, 5, 304, 15),
    list: r(8, 24, 90, 142),
    detail: r(104, 24, 122, 142),
    materials: r(232, 24, 80, 142),
    bottom: r(8, 171, 304, 22),
    close: r(248, 5, 64, 14),
    rowH: 12 * scale,
    materialRowH: 12 * scale,
    icon: r(137, 26, 56, 56),
  };
}
