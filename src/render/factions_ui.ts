/* ── Faction relations matrix (F key) ─────────────────────────── */

import { type Entity, Faction, type GameState, ZoneFaction } from '../core/types';
import { getFactionRel } from '../data/relations';
import { getFactionUiSnapshot, type FactionUiSnapshot } from '../systems/factions';
import { getAlifeLeaderboardSnapshot, type AlifeLeaderboardEntry, type AlifeLeaderboardSnapshot } from '../systems/alife';
import { menuCloseHint } from '../systems/controls';
import { drawNeuroPanel, drawGlitchText } from './hud_fx';
import { fitText } from './ui_text';

const MATRIX_LABELS = ['Игрок', 'Граждане', 'Ликвид.', 'Культ.', 'Учёные', 'Дикие'];
const MATRIX_FACTIONS = [Faction.PLAYER, Faction.CITIZEN, Faction.LIQUIDATOR, Faction.CULTIST, Faction.SCIENTIST, Faction.WILD];
const ZONE_FACTION_NAMES: Record<ZoneFaction, string> = {
  [ZoneFaction.CITIZEN]: 'Граждане',
  [ZoneFaction.LIQUIDATOR]: 'Ликвидаторы',
  [ZoneFaction.CULTIST]: 'Культ',
  [ZoneFaction.SAMOSBOR]: 'Самосбор',
  [ZoneFaction.WILD]: 'Дикие',
  [ZoneFaction.SCIENTIST]: 'Учёные',
};
const ZONE_FACTION_COLORS: Record<ZoneFaction, string> = {
  [ZoneFaction.CITIZEN]: '#4abe91',
  [ZoneFaction.LIQUIDATOR]: '#5b9eee',
  [ZoneFaction.CULTIST]: '#bc59ff',
  [ZoneFaction.SAMOSBOR]: '#e64e5c',
  [ZoneFaction.WILD]: '#e0a745',
  [ZoneFaction.SCIENTIST]: '#67d8e8',
};
const FACTION_SHORT: Record<Faction, string> = {
  [Faction.PLAYER]: 'ИГР',
  [Faction.CITIZEN]: 'ГРЖ',
  [Faction.LIQUIDATOR]: 'ЛИК',
  [Faction.CULTIST]: 'КУЛ',
  [Faction.SCIENTIST]: 'НИИ',
  [Faction.WILD]: 'ДИК',
};

function eventColor(severity: number): string {
  return severity >= 5 ? '#f35' : severity >= 4 ? '#fa4' : severity >= 3 ? '#fc6' : '#8cf';
}

function drawRelationMatrix(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sy: number,
): void {
  const cols = MATRIX_LABELS.length;
  const cellW = w / (cols + 1);
  const cellH = h / (cols + 1);
  const fontSize = Math.min(cellH * 0.55, cellW * 0.15, 10 * sy);
  const labelFontSize = Math.min(cellH * 0.5, cellW * 0.14, 9 * sy);

  ctx.strokeStyle = 'rgba(100,100,100,0.3)';
  ctx.lineWidth = 1;
  ctx.font = `bold ${labelFontSize}px monospace`;
  for (let c = 0; c < cols; c++) {
    const cx = x + (c + 1) * cellW + cellW / 2;
    const cy = y + cellH / 2;
    ctx.fillStyle = c === 0 ? '#fff' : '#ccc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, MATRIX_LABELS[c], cellW * 0.95), cx, cy);
  }

  for (let r = 0; r < cols; r++) {
    const ry = y + (r + 1) * cellH + cellH / 2;
    ctx.fillStyle = r === 0 ? '#fff' : '#ccc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${labelFontSize}px monospace`;
    ctx.fillText(fitText(ctx, MATRIX_LABELS[r], cellW * 0.95), x + cellW / 2, ry);

    ctx.font = `${fontSize}px monospace`;
    for (let c = 0; c < cols; c++) {
      const v = getFactionRel(MATRIX_FACTIONS[r], MATRIX_FACTIONS[c]);
      const cx = x + (c + 1) * cellW + cellW / 2;
      if (r === c) {
        ctx.fillStyle = '#555';
        ctx.fillText('-', cx, ry);
      } else {
        ctx.fillStyle = v >= 50 ? '#4f4' : v >= 0 ? '#cc4' : v >= -50 ? '#f84' : '#f44';
        ctx.fillText(String(v), cx, ry);
      }
    }

    const lineY = y + (r + 1) * cellH;
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + w, lineY);
    ctx.stroke();
  }

  for (let c = 1; c <= cols; c++) {
    const lx = x + c * cellW;
    ctx.beginPath();
    ctx.moveTo(lx, y + cellH);
    ctx.lineTo(lx, y + h);
    ctx.stroke();
  }
}

function drawFactionSnapshotPanel(
  ctx: CanvasRenderingContext2D,
  snapshot: FactionUiSnapshot | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  sy: number,
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,200,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = '#0ca';
  ctx.fillText('ТЕРРИТОРИИ И СОБЫТИЯ', x + 6, y + 5);

  ctx.font = `${8 * sy}px monospace`;
  if (!snapshot) {
    ctx.fillStyle = '#777';
    ctx.fillText(fitText(ctx, 'Нет снимка: подождите тик симуляции.', w - 12), x + 6, y + 20 * sy);
    return;
  }

  let yy = y + 19 * sy;
  ctx.fillStyle = snapshot.contestedZones > 0 ? '#ffd36a' : '#688';
  ctx.fillText(`Спорные фронты: ${snapshot.contestedZones}`, x + 6, yy);
  yy += 11 * sy;

  for (const owner of snapshot.owners) {
    if (owner.cells <= 0) continue;
    ctx.fillStyle = ZONE_FACTION_COLORS[owner.faction];
    ctx.fillRect(x + 7, yy + 2, 6, 6);
    ctx.fillStyle = owner.fronts > 0 ? '#ffd36a' : '#bbb';
    const line = `${ZONE_FACTION_NAMES[owner.faction]}: ${Math.round(owner.cells / 1000)}k кл.${owner.fronts > 0 ? `, фронт ${owner.fronts}` : ''}`;
    ctx.fillText(fitText(ctx, line, w - 20), x + 17, yy);
    yy += 10 * sy;
  }

  yy += 3 * sy;
  ctx.fillStyle = '#8ac';
  ctx.fillText('Давление', x + 6, yy);
  yy += 10 * sy;
  let drawnContested = 0;
  for (const zone of snapshot.zones) {
    if (!zone.contested) continue;
    if (drawnContested >= 4 || yy > y + h - 54 * sy) break;
    const line = `С${zone.zoneId + 1}: ${ZONE_FACTION_NAMES[zone.owner]} / ${ZONE_FACTION_NAMES[zone.dominant]} ${Math.round(zone.pressure * 100)}%`;
    ctx.fillStyle = '#ffd36a';
    ctx.fillText(fitText(ctx, line, w - 12), x + 6, yy);
    yy += 10 * sy;
    drawnContested++;
  }
  if (drawnContested === 0) {
    ctx.fillStyle = '#666';
    ctx.fillText('Границы устойчивы.', x + 6, yy);
    yy += 10 * sy;
  }

  yy += 3 * sy;
  ctx.fillStyle = '#8ac';
  ctx.fillText('Недавнее', x + 6, yy);
  yy += 10 * sy;
  if (snapshot.recentEvents.length === 0) {
    ctx.fillStyle = '#666';
    ctx.fillText('Фракционных событий пока нет.', x + 6, yy);
    return;
  }
  for (const event of snapshot.recentEvents) {
    if (yy > y + h - 10 * sy) break;
    const age = Math.max(0, Math.round(snapshot.time - event.time));
    const zone = event.zoneId >= 0 ? `С${event.zoneId + 1}` : 'сектор ?';
    const phase = event.phase === 'aftermath' ? ' итог' : event.phase === 'start' ? ' старт' : '';
    const name = event.name || String(event.type);
    ctx.fillStyle = eventColor(event.severity);
    ctx.fillText(fitText(ctx, `${age}s ${zone}: ${name}${phase}`, w - 12), x + 6, yy);
    yy += 10 * sy;
  }
}

function karmaColor(karma: number): string {
  return karma >= 48 ? '#8f8' : karma >= 0 ? '#bdc' : karma >= -48 ? '#fa6' : '#f66';
}

function drawRankRow(
  ctx: CanvasRenderingContext2D,
  entry: AlifeLeaderboardEntry,
  x: number,
  y: number,
  w: number,
  rowH: number,
  sy: number,
): void {
  if (entry.player) {
    ctx.fillStyle = 'rgba(30,120,105,0.28)';
    ctx.fillRect(x + 3, y - 1, w - 6, rowH);
  }
  ctx.font = `${7.5 * sy}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = entry.player ? '#fff' : '#bbb';
  const prefix = `${String(entry.rank).padStart(3, ' ')} ${FACTION_SHORT[entry.faction]} L${String(entry.level).padStart(2, '0')}`;
  ctx.fillText(prefix, x + 6, y);
  ctx.fillStyle = karmaColor(entry.karma);
  ctx.fillText(`K${entry.karma}`, x + Math.min(w - 42 * sy, 76 * sy), y);
  ctx.fillStyle = entry.player ? '#eff' : '#9ab';
  const nameX = x + 112 * sy;
  const nameW = Math.max(24, w - (nameX - x) - 58 * sy);
  ctx.fillText(fitText(ctx, entry.name, nameW), nameX, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#edb';
  ctx.fillText(String(entry.score), x + w - 6, y);
  ctx.textAlign = 'left';
}

function drawAlifeRankPanel(
  ctx: CanvasRenderingContext2D,
  snapshot: AlifeLeaderboardSnapshot,
  scroll: number,
  x: number,
  y: number,
  w: number,
  h: number,
  sy: number,
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,160,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = '#0d9';
  ctx.fillText('A-LIFE РЕЙТИНГ ТОП 100', x + 6, y + 5);

  ctx.font = `${7.5 * sy}px monospace`;
  ctx.fillStyle = '#9ab';
  const self = snapshot.player;
  ctx.fillText(fitText(ctx, `Вы #${self.rank}/${snapshot.totalAlive} score ${self.score} karma ${self.karma}`, w - 12), x + 6, y + 18 * sy);

  const rowH = 10 * sy;
  const listY = y + 32 * sy;
  const rows = Math.max(1, Math.floor((h - 40 * sy) / rowH));
  const maxScroll = Math.max(0, snapshot.entries.length - rows);
  const start = Math.max(0, Math.min(maxScroll, scroll));
  const end = Math.min(snapshot.entries.length, start + rows);
  for (let i = start; i < end; i++) {
    drawRankRow(ctx, snapshot.entries[i], x, listY + (i - start) * rowH, w, rowH, sy);
  }
  if (!snapshot.entries.some(entry => entry.player) || self.rank > snapshot.entries.length) {
    const selfY = y + h - 12 * sy;
    ctx.strokeStyle = 'rgba(0,220,160,0.22)';
    ctx.beginPath();
    ctx.moveTo(x + 6, selfY - 3 * sy);
    ctx.lineTo(x + w - 6, selfY - 3 * sy);
    ctx.stroke();
    drawRankRow(ctx, self, x, selfY, w, rowH, sy);
  }
}

export function drawFactionMenu(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  _entities: Entity[],
  state: GameState,
  sx: number, sy: number,
  time = 0,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Fullscreen neuro-panel background
  ctx.fillStyle = '#00040a';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, 0, 0, w, h, time, 95);

  // Title
  ctx.font = `bold ${12 * sy}px monospace`;
  ctx.textAlign = 'center';
  drawGlitchText(ctx, fitText(ctx, 'ОТНОШЕНИЯ И A-LIFE РЕЙТИНГ', w - 16 * sx), w / 2, 20 * sy, time, 950, '#0ca', 12 * sy);

  const snapshot = getFactionUiSnapshot();
  const ranks = getAlifeLeaderboardSnapshot(state, player, 100);
  const topY = 36 * sy;
  const botY = h - 16 * sy;
  const pad = 6 * sx;
  const sideBySide = w >= 520 * sx;
  const sideW = sideBySide ? Math.min(230 * sx, w * 0.38) : w - pad * 2;
  const tableW = sideBySide ? w - sideW - pad * 3 : w - pad * 2;
  const tableH = sideBySide ? Math.max(120 * sy, (botY - topY) * 0.52) : Math.max(120 * sy, (botY - topY) * 0.42);
  drawRelationMatrix(ctx, pad, topY, tableW, tableH, sy);
  if (sideBySide) {
    drawFactionSnapshotPanel(
      ctx,
      snapshot,
      pad,
      topY + tableH + 6 * sy,
      tableW,
      botY - (topY + tableH + 6 * sy),
      sy,
    );
  }
  drawAlifeRankPanel(
    ctx,
    ranks,
    state.factionRankScroll ?? 0,
    sideBySide ? pad * 2 + tableW : pad,
    sideBySide ? topY : topY + tableH + 6 * sy,
    sideW,
    sideBySide ? botY - topY : botY - (topY + tableH + 6 * sy),
    sy,
  );

  // Hint
  ctx.fillStyle = '#555';
  ctx.font = `${8 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, `${menuCloseHint()} закрыть  ↑↓ рейтинг`, w - 16 * sx), w / 2, botY + 2 * sy);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
