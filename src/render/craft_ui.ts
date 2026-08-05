import { type CraftMenuMode, type Entity, type GameState } from '../core/types';
import {
  CRAFT_MATERIAL_DEFS,
  type CraftMaterialId,
  type CraftVector,
} from '../data/craft_materials';
import { ITEMS } from '../data/catalog';
import { controlBindingLabel, menuCloseHint } from '../systems/controls';
import {
  craftEntryMissingLine as runtimeCraftEntryMissingLine,
  craftMenuSnapshot,
  type CraftMenuDisassembleEntry,
  type CraftMenuRecipeEntry,
  type CraftMenuSnapshot,
} from '../systems/crafting';
import { drawGlitchText, drawNeuroPanel, drawStaticNoise } from './hud_fx';
import { drawItemGridIcon } from './item_sprites';
import { craftMenuLayout } from './ui_layout';
import { drawWrappedText, fitTextStable } from './ui_text';

export type CraftEntry =
  | CraftMenuRecipeEntry
  | CraftMenuDisassembleEntry;

export interface CraftMaterialTextPart {
  materialId: CraftMaterialId;
  label: string;
  value: number;
  color: string;
}

export interface CraftMaterialPanelRow {
  code: string;
  name: string;
  color: string;
}

function menuTitle(mode: CraftMenuMode): string {
  return mode === 'craft' ? 'ТОКАРНЫЙ КРАФТ' : 'РАЗБОР НА ВЕРСТАКЕ';
}

export function craftMenuEntries(snapshot: CraftMenuSnapshot): readonly CraftEntry[] {
  return snapshot.mode === 'craft' ? snapshot.recipes : snapshot.inventory;
}

export function craftMenuFallbackText(mode: CraftMenuMode): string {
  return mode === 'craft' ? 'Известных рецептов нет.' : 'Инвентарь пуст.';
}

export function clampCraftCursor(cursor: number, snapshot: CraftMenuSnapshot): number {
  const entries = craftMenuEntries(snapshot);
  if (entries.length === 0) return 0;
  return Math.max(0, Math.min(entries.length - 1, Math.floor(cursor)));
}

export function materialPanelRows(materials: CraftVector): string[] {
  return materialPanelLegendRows(materials).map(row => row.code);
}

export function materialPanelLegendRows(materials: CraftVector): CraftMaterialPanelRow[] {
  return CRAFT_MATERIAL_DEFS.map((def, index) => {
    const value = Math.max(0, Math.min(999, Math.floor(materials[index] ?? 0)));
    return {
      code: `${def.shortName} ${String(value).padStart(3, '0')}`,
      name: def.name,
      color: def.color,
    };
  });
}

function selectedEntry(snapshot: CraftMenuSnapshot, cursor: number): CraftEntry | undefined {
  return craftMenuEntries(snapshot)[clampCraftCursor(cursor, snapshot)];
}

function entryName(entry: CraftEntry): string {
  return entry.kind === 'recipe'
    ? `${entry.name}${entry.resultCount > 1 ? ` x${entry.resultCount}` : ''}`
    : `${entry.name}${entry.count > 1 ? ` x${entry.count}` : ''}`;
}

function entryColor(entry: CraftEntry, selected: boolean): string {
  if (entry.kind === 'recipe') {
    if (selected) return entry.craftable ? '#dff' : '#b98';
    return entry.craftable ? '#8fe' : '#657070';
  }
  if (selected) return entry.canDisassemble ? '#ffd' : '#b98';
  return entry.canDisassemble ? '#ddd' : '#68625a';
}

function vectorHeading(entry: CraftEntry): string {
  return entry.kind === 'recipe' ? 'СОСТАВ' : 'СОСТАВ ПРЕДМЕТА';
}

function missingLine(entry: CraftEntry): string {
  if (entry.kind === 'recipe') return runtimeCraftEntryMissingLine(entry);
  if (!entry.canDisassemble) return entry.blockedReason === 'invalid_station' ? 'нужен верстак' : 'выход не рассчитан';
  const outputs = entry.possibleOutputs
    .map(output => `${output.label} ${output.weight}`)
    .join('  ');
  return outputs ? `1 из: ${outputs}` : 'выход не рассчитан';
}

export function craftVectorLine(vector: CraftVector): string {
  const parts = craftMaterialTextParts(vector);
  return parts.length > 0 ? parts.map(part => `${part.label} ${part.value}`).join('  ') : 'нет';
}

export function craftMaterialTextParts(vector: CraftVector): CraftMaterialTextPart[] {
  const parts: CraftMaterialTextPart[] = [];
  for (let i = 0; i < CRAFT_MATERIAL_DEFS.length; i++) {
    const value = Math.max(0, Math.floor(vector[i] ?? 0));
    if (value <= 0) continue;
    const def = CRAFT_MATERIAL_DEFS[i];
    if (!def) continue;
    parts.push({ materialId: def.id, label: def.shortName, value, color: def.color });
  }
  return parts;
}

export function craftEntryActionText(entry: CraftEntry): string {
  if (entry.kind === 'recipe') {
    return entry.craftable ? 'ГОТОВО К СБОРКЕ' : `НЕДОСТАЕТ: ${missingLine(entry)}`;
  }
  return entry.canDisassemble ? `ВЫХОД: ${missingLine(entry)}` : `НЕЛЬЗЯ: ${missingLine(entry)}`;
}

export function craftEntryCanAct(entry: CraftEntry): boolean {
  return entry.kind === 'recipe' ? entry.craftable : entry.canDisassemble;
}

function drawPanelTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, sy: number, color: string): void {
  ctx.font = `${6.4 * sy}px monospace`;
  ctx.fillStyle = color;
  ctx.fillText(fitTextStable(ctx, text, w), x, y);
}

function materialColor(materialId: CraftMaterialId): string {
  const def = CRAFT_MATERIAL_DEFS.find(candidate => candidate.id === materialId);
  return def?.color ?? '#d7d0bd';
}

function drawTextSegment(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  x: number,
  y: number,
  maxW: number,
): number {
  if (maxW <= 0 || text.length === 0) return 0;
  const fitted = fitTextStable(ctx, text, maxW);
  if (!fitted) return 0;
  ctx.fillStyle = color;
  ctx.fillText(fitted, x, y);
  return ctx.measureText(fitted).width;
}

function drawColoredMaterialParts(
  ctx: CanvasRenderingContext2D,
  parts: readonly CraftMaterialTextPart[],
  x: number,
  y: number,
  maxW: number,
  emptyText = 'нет',
): void {
  if (parts.length === 0) {
    drawTextSegment(ctx, emptyText, '#d7d0bd', x, y, maxW);
    return;
  }
  let used = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const text = `${i > 0 ? '  ' : ''}${part.label} ${part.value}`;
    const drawn = drawTextSegment(ctx, text, part.color, x + used, y, maxW - used);
    used += drawn;
    if (drawn <= 0 || ctx.measureText(text).width > maxW - (used - drawn)) break;
  }
}

function drawPrefixedMaterialParts(
  ctx: CanvasRenderingContext2D,
  prefix: string,
  prefixColor: string,
  parts: readonly CraftMaterialTextPart[],
  x: number,
  y: number,
  maxW: number,
  emptyText = 'нет',
): void {
  const prefixText = `${prefix} `;
  const prefixW = ctx.measureText(prefixText).width;
  if (prefixW >= maxW) {
    drawTextSegment(ctx, prefixText, prefixColor, x, y, maxW);
    return;
  }
  ctx.fillStyle = prefixColor;
  ctx.fillText(prefixText, x, y);
  drawColoredMaterialParts(ctx, parts, x + prefixW, y, maxW - prefixW, emptyText);
}

function drawCraftActionText(ctx: CanvasRenderingContext2D, entry: CraftEntry, x: number, y: number, maxW: number): void {
  if (entry.kind === 'recipe') {
    if (entry.craftable) {
      drawTextSegment(ctx, craftEntryActionText(entry), '#8f8', x, y, maxW);
      return;
    }
    drawPrefixedMaterialParts(ctx, 'НЕДОСТАЕТ:', '#fa4', craftMaterialTextParts(entry.missing), x, y, maxW, 'ничего');
    return;
  }

  if (!entry.canDisassemble) {
    drawTextSegment(ctx, craftEntryActionText(entry), '#fa4', x, y, maxW);
    return;
  }
  const outputs: CraftMaterialTextPart[] = entry.possibleOutputs.map(output => ({
    materialId: output.materialId,
    label: output.label,
    value: output.weight,
    color: materialColor(output.materialId),
  }));
  drawPrefixedMaterialParts(ctx, 'ВЫХОД: 1 из:', '#8f8', outputs, x, y, maxW, 'выход не рассчитан');
}

export function drawCraftMenu(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  state: GameState,
  sx: number,
  sy: number,
  uiTime = state.time,
): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const layout = craftMenuLayout(cw, ch);
  const s = layout.scale;
  sx = s;
  sy = s;
  const snapshot = craftMenuSnapshot({
    state,
    actor: player,
    mode: state.craftMode,
    stationKind: state.craftStationKind,
    filter: state.craftFilter,
  });
  const entries = craftMenuEntries(snapshot);
  const cursor = clampCraftCursor(state.craftCursor, snapshot);

  ctx.save();
  ctx.fillStyle = '#010506';
  ctx.fillRect(0, 0, cw, ch);
  drawNeuroPanel(ctx, layout.originX, layout.originY, 320 * s, 200 * s, uiTime, 930);
  drawStaticNoise(ctx, layout.originX, layout.originY, 320 * s, 200 * s, uiTime, 0.012);

  drawGlitchText(ctx, menuTitle(snapshot.mode), layout.title.x, layout.title.y, uiTime, 931, '#6cf', 9 * sy);
  ctx.font = `${6.2 * sy}px monospace`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#567';
  ctx.fillText(fitTextStable(ctx, `${menuCloseHint()} закрыть`, layout.close.w), layout.close.x + layout.close.w, layout.close.y);
  ctx.textAlign = 'left';

  for (const rect of [layout.list, layout.detail, layout.materials, layout.bottom]) {
    ctx.fillStyle = 'rgba(0,10,14,0.78)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = 'rgba(80,220,200,0.25)';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }

  drawPanelTitle(ctx, snapshot.mode === 'craft' ? 'РЕЦЕПТЫ' : 'ИНВЕНТАРЬ', layout.list.x + 5 * sx, layout.list.y + 4 * sy, layout.list.w - 10 * sx, sy, '#8cf');
  ctx.font = `${7 * sy}px monospace`;
  const listTop = layout.list.y + 16 * sy;
  const visibleRows = Math.max(1, Math.floor((layout.list.h - 20 * sy) / layout.rowH));
  const first = Math.max(0, Math.min(Math.max(0, entries.length - visibleRows), cursor - Math.floor(visibleRows * 0.5)));
  if (entries.length === 0) {
    ctx.fillStyle = '#667';
    drawWrappedText(ctx, craftMenuFallbackText(snapshot.mode), layout.list.x + 5 * sx, listTop, layout.list.w - 10 * sx, 9 * sy, 3);
  } else {
    for (let row = 0; row < visibleRows; row++) {
      const index = first + row;
      const entry = entries[index];
      if (!entry) break;
      const y = listTop + row * layout.rowH;
      const selected = index === cursor;
      if (selected) {
        ctx.fillStyle = 'rgba(0,90,82,0.55)';
        ctx.fillRect(layout.list.x + 3 * sx, y - 2 * sy, layout.list.w - 6 * sx, layout.rowH);
        ctx.strokeStyle = 'rgba(80,255,220,0.5)';
        ctx.strokeRect(layout.list.x + 3 * sx + 0.5, y - 2 * sy + 0.5, layout.list.w - 6 * sx - 1, layout.rowH - 1);
      }
      ctx.fillStyle = entryColor(entry, selected);
      ctx.fillText(fitTextStable(ctx, entryName(entry), layout.list.w - 12 * sx), layout.list.x + 6 * sx, y);
    }
  }

  drawPanelTitle(ctx, 'ДЕТАЛИ', layout.detail.x + 5 * sx, layout.detail.y + 4 * sy, layout.detail.w - 10 * sx, sy, '#8cf');
  const entry = selectedEntry(snapshot, cursor);
  if (entry) {
    const iconSize = Math.min(layout.icon.w, layout.icon.h);
    drawItemGridIcon(ctx, entry.itemId, entry.name, layout.icon.x, layout.icon.y, iconSize, sx, sy, true, 1, {
      nameYUnits: 7,
      iconTopUnits: 12,
      bottomReserveUnits: 2,
      maxIconUnits: 48,
    });
    let y = layout.detail.y + 61 * sy;
    ctx.fillStyle = entryColor(entry, true);
    ctx.font = `${7.8 * sy}px monospace`;
    ctx.fillText(fitTextStable(ctx, entryName(entry), layout.detail.w - 10 * sx), layout.detail.x + 5 * sx, y);
    y += 10 * sy;
    const desc = entry.description || ITEMS[entry.itemId]?.desc || 'Описание отсутствует.';
    ctx.fillStyle = '#9aa';
    ctx.font = `${6.2 * sy}px monospace`;
    y = drawWrappedText(ctx, desc, layout.detail.x + 5 * sx, y, layout.detail.w - 10 * sx, 8 * sy, 2);
    y += 3 * sy;
    ctx.fillStyle = '#8cf';
    ctx.fillText(vectorHeading(entry), layout.detail.x + 5 * sx, y);
    y += 8 * sy;
    drawColoredMaterialParts(ctx, craftMaterialTextParts(entry.components), layout.detail.x + 5 * sx, y, layout.detail.w - 10 * sx);
    y += 10 * sy;
    drawCraftActionText(ctx, entry, layout.detail.x + 5 * sx, y, layout.detail.w - 10 * sx);
    y += 10 * sy;
    ctx.fillStyle = '#778';
    const station = entry.kind === 'recipe' ? entry.station : snapshot.stationKind;
    ctx.fillText(fitTextStable(ctx, `СТАНЦИЯ: ${station}`, layout.detail.w - 10 * sx), layout.detail.x + 5 * sx, y);
  } else {
    ctx.fillStyle = '#667';
    ctx.font = `${7 * sy}px monospace`;
    drawWrappedText(ctx, craftMenuFallbackText(snapshot.mode), layout.detail.x + 8 * sx, layout.detail.y + 28 * sy, layout.detail.w - 16 * sx, 9 * sy, 4);
  }

  drawPanelTitle(ctx, 'МАТЕРИАЛЫ', layout.materials.x + 5 * sx, layout.materials.y + 4 * sy, layout.materials.w - 10 * sx, sy, '#8cf');
  const rows = materialPanelLegendRows(snapshot.materials);
  const codeX = layout.materials.x + 5 * sx;
  const nameX = layout.materials.x + 45 * sx;
  const codeW = Math.max(0, nameX - codeX - 4 * sx);
  const nameW = Math.max(0, layout.materials.x + layout.materials.w - 5 * sx - nameX);
  for (let i = 0; i < rows.length; i++) {
    const y = layout.materials.y + 18 * sy + i * layout.materialRowH;
    const row = rows[i];
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillStyle = row.color;
    ctx.fillText(fitTextStable(ctx, row.code, codeW), codeX, y);
    ctx.font = `${4 * sy}px monospace`;
    ctx.fillStyle = row.color;
    ctx.fillText(fitTextStable(ctx, row.name, nameW), nameX, y - 0.7 * sy);
  }

  ctx.font = `${6.2 * sy}px monospace`;
  ctx.fillStyle = '#789';
  const hints = `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} выбор  |  ${controlBindingLabel('gameMenu')} ${snapshot.mode === 'craft' ? 'собрать' : 'разобрать'}  |  ${menuCloseHint()} назад`;
  ctx.fillText(fitTextStable(ctx, hints, layout.bottom.w - 10 * sx), layout.bottom.x + 5 * sx, layout.bottom.y + 6 * sy);
  ctx.restore();
}
