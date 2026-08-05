import type { DemosProfileDetails, DemosProfileFeedEntry } from '../systems/demos_profiles';
import { fitText, wrapTextLines } from './ui_text';

export interface DrawDemosProfilePanelOptions {
  title?: string;
  selectedTab?: string;
  tabs?: readonly string[];
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  sy: number,
  color = '#cbd7d7',
): void {
  const labelW = Math.min(82 * sy, w * 0.42);
  ctx.font = `${7.2 * sy}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#668f91';
  ctx.fillText(fitText(ctx, label, labelW), x, y);
  ctx.fillStyle = color;
  ctx.fillText(fitText(ctx, value, Math.max(16, w - labelW - 4 * sy)), x + labelW, y);
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  sy: number,
  dead = false,
): number {
  const label = fitText(ctx, text, maxW - 8 * sy);
  const chipW = Math.min(maxW, ctx.measureText(label).width + 8 * sy);
  ctx.fillStyle = dead ? 'rgba(52,26,32,0.86)' : 'rgba(0,54,50,0.84)';
  ctx.fillRect(x, y, chipW, 10 * sy);
  ctx.strokeStyle = dead ? 'rgba(190,70,82,0.34)' : 'rgba(40,210,190,0.34)';
  ctx.strokeRect(x + 0.5, y + 0.5, chipW - 1, 10 * sy - 1);
  ctx.fillStyle = dead ? '#d99' : '#9fe';
  ctx.fillText(label, x + 4 * sy, y + 2 * sy);
  return chipW;
}

function prettyTag(text: string): string {
  return text.replace(/^perk:/, '').replace(/[_:.-]+/g, ' ').slice(0, 32);
}

export function drawDemosTabsHeader(
  ctx: CanvasRenderingContext2D,
  tabs: readonly string[],
  selected: string,
  x: number,
  y: number,
  w: number,
  sy: number,
): void {
  if (tabs.length === 0) return;
  const gap = 3 * sy;
  const tabW = Math.max(22 * sy, (w - gap * (tabs.length - 1)) / tabs.length);
  ctx.font = `${7.4 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < tabs.length; i++) {
    const tx = x + i * (tabW + gap);
    const active = tabs[i] === selected;
    ctx.fillStyle = active ? 'rgba(0,72,66,0.88)' : 'rgba(0,18,22,0.78)';
    ctx.fillRect(tx, y, tabW, 12 * sy);
    ctx.strokeStyle = active ? 'rgba(42,255,210,0.62)' : 'rgba(0,120,116,0.28)';
    ctx.strokeRect(tx + 0.5, y + 0.5, tabW - 1, 12 * sy - 1);
    ctx.fillStyle = active ? '#25ffd0' : '#668f91';
    ctx.fillText(fitText(ctx, tabs[i], tabW - 6 * sy), tx + tabW / 2, y + 2 * sy);
  }
  ctx.textAlign = 'left';
}

export function drawDemosProfilePanel(
  ctx: CanvasRenderingContext2D,
  details: DemosProfileDetails,
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  opts: DrawDemosProfilePanelOptions = {},
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = details.dead ? 'rgba(180,70,82,0.46)' : 'rgba(0,220,190,0.42)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pad = 7 * sx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = details.dead ? '#d98' : '#25ffd0';
  ctx.fillText(fitText(ctx, opts.title ?? `ПРОФИЛЬ alife:${details.alifeId}`, w - pad * 2), x + pad, y + 6 * sy);

  let rowY = y + 23 * sy;
  if (opts.tabs && opts.tabs.length > 0) {
    drawDemosTabsHeader(ctx, opts.tabs, opts.selectedTab ?? opts.tabs[0], x + pad, rowY, w - pad * 2, sy);
    rowY += 17 * sy;
  }

  const rowW = w - pad * 2;
  drawRow(ctx, 'статус', details.dead ? 'мертвый профиль' : 'активная запись', x + pad, rowY, rowW, sy, details.dead ? '#d98' : '#cfd'); rowY += 12 * sy;
  if (details.packagePublicLine) {
    drawRow(ctx, 'досье', details.packagePublicLine, x + pad, rowY, rowW, sy, '#d9f1ed');
    rowY += 12 * sy;
  }
  if (details.packageBioLine) {
    drawRow(ctx, 'био', details.packageBioLine, x + pad, rowY, rowW, sy);
    rowY += 12 * sy;
  }
  drawRow(ctx, 'возраст', `${details.age}, ${details.ageBandLabel}, ${details.sexLabel}`, x + pad, rowY, rowW, sy); rowY += 12 * sy;
  drawRow(ctx, 'капитал', details.capitalLabel, x + pad, rowY, rowW, sy, '#edb'); rowY += 12 * sy;
  drawRow(ctx, 'счёт', details.accountLabel, x + pad, rowY, rowW, sy, '#d9f1ed'); rowY += 12 * sy;
  drawRow(ctx, 'отношение', details.relationToPlayerLabel, x + pad, rowY, rowW, sy); rowY += 12 * sy;
  drawRow(ctx, 'семья', details.familyStatusLabel, x + pad, rowY, rowW, sy); rowY += 12 * sy;
  drawRow(ctx, 'связи', `друзья ${details.friendsCount} / враги ${details.enemiesCount} / семья ${details.familyCount}`, x + pad, rowY, rowW, sy); rowY += 12 * sy;
  if (details.packageOriginLabel) {
    drawRow(ctx, 'откуда', details.packageOriginLabel, x + pad, rowY, rowW, sy);
    rowY += 12 * sy;
  }
  if (details.packageWorkLabel) {
    drawRow(ctx, 'роль', details.packageWorkLabel, x + pad, rowY, rowW, sy, '#edb');
    rowY += 12 * sy;
  }
  if (details.favoriteWorkLabel) {
    drawRow(ctx, 'работа', details.favoriteWorkLabel, x + pad, rowY, rowW, sy, '#edb');
    rowY += 12 * sy;
  }
  if (details.fearLabel) {
    drawRow(ctx, 'страх', details.fearLabel, x + pad, rowY, rowW, sy, '#eaa');
    rowY += 12 * sy;
  }
  drawRow(ctx, 'лента', details.lastPostId ? `post:${details.lastPostId}, упоминаний ${details.mentionsRecent}` : `упоминаний ${details.mentionsRecent}`, x + pad, rowY, rowW, sy); rowY += 15 * sy;

  ctx.font = `${7 * sy}px monospace`;
  let chipX = x + pad;
  for (const trait of details.traits.slice(0, 4)) {
    const used = drawChip(ctx, trait.label, chipX, rowY, Math.min(86 * sx, x + w - pad - chipX), sy, details.dead);
    chipX += used + 4 * sx;
    if (chipX > x + w - pad - 22 * sx) break;
  }
  rowY += 14 * sy;

  chipX = x + pad;
  for (const tag of details.packageFlavorTags.slice(0, 5)) {
    const used = drawChip(ctx, prettyTag(tag), chipX, rowY, Math.min(88 * sx, x + w - pad - chipX), sy, details.dead);
    chipX += used + 4 * sx;
    if (chipX > x + w - pad - 22 * sx) break;
  }
  if (details.packageFlavorTags.length > 0) rowY += 14 * sy;

  chipX = x + pad;
  for (const interest of details.interests.slice(0, 5)) {
    const used = drawChip(ctx, interest, chipX, rowY, Math.min(88 * sx, x + w - pad - chipX), sy, details.dead);
    chipX += used + 4 * sx;
    if (chipX > x + w - pad - 22 * sx) break;
  }
}

export function drawDemosProfileFeedPanel(
  ctx: CanvasRenderingContext2D,
  feed: readonly DemosProfileFeedEntry[],
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  title = 'ЗАПИСИ ПРОФИЛЯ',
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,190,0.34)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const pad = 7 * sx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${8.5 * sy}px monospace`;
  ctx.fillStyle = '#25ffd0';
  ctx.fillText(fitText(ctx, title, w - pad * 2), x + pad, y + 6 * sy);

  let rowY = y + 22 * sy;
  const bottom = y + h - 6 * sy;
  const rowW = w - pad * 2;
  if (feed.length === 0) {
    ctx.font = `${8 * sy}px monospace`;
    ctx.fillStyle = '#789';
    ctx.fillText(fitText(ctx, 'Свежих записей нет.', rowW), x + pad, rowY);
    return;
  }

  for (const entry of feed) {
    if (rowY >= bottom) break;
    const lines = wrapTextLines(ctx, entry.summary, rowW - 8 * sx, 2, { stable: true });
    const rowH = (15 + lines.length * 9) * sy;
    if (rowY + rowH > bottom) break;
    ctx.fillStyle = 'rgba(2,18,22,0.72)';
    ctx.fillRect(x + pad, rowY, rowW, rowH);
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillStyle = '#6a9';
    ctx.fillText(fitText(ctx, `post:${entry.postId} ${entry.label}`, rowW - 8 * sx), x + pad + 4 * sx, rowY + 3 * sy);
    ctx.fillStyle = '#d9f1ed';
    let textY = rowY + 13 * sy;
    for (const line of lines) {
      ctx.fillText(line, x + pad + 4 * sx, textY);
      textY += 9 * sy;
    }
    rowY += rowH + 4 * sy;
  }
}
