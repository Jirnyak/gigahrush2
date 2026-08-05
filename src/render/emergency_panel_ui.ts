/* ── Emergency panel canvas menu ─────────────────────────────── */

import type { Entity } from '../core/types';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { getEmergencyPanelMenuSnapshot } from '../systems/emergency_panels';
import { drawGlitchText, drawNeuroPanel, flicker, textJitter } from './hud_fx';
import { fitText } from './ui_text';

export function drawEmergencyPanelMenu(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  sx: number,
  sy: number,
  time: number,
): void {
  const snap = getEmergencyPanelMenuSnapshot(player);
  if (!snap) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const panelW = Math.min(w - 22 * sx, 250 * sx);
  const rowH = 18 * sy;
  const panelH = Math.min(h - 28 * sy, (58 + snap.options.length * 22) * sy);
  const x = (w - panelW) * 0.5;
  const y = Math.max(12 * sy, (h - panelH) * 0.5);

  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 731);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${12 * sy}px monospace`;
  const jitter = textJitter(time, 732);
  drawGlitchText(ctx, fitText(ctx, snap.title, panelW - 16 * sx), x + 8 * sx + jitter.dx, y + 7 * sy + jitter.dy, time, 732, snap.color, 12 * sy);

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = `rgba(180,210,210,${flicker(time, 733)})`;
  ctx.fillText(fitText(ctx, `${snap.subtitle} / ${snap.status}`, panelW - 16 * sx), x + 8 * sx, y + 24 * sy);

  let cy = y + 39 * sy;
  for (let i = 0; i < snap.options.length; i++) {
    const option = snap.options[i];
    const selected = i === snap.selected;
    const ox = x + 8 * sx;
    const oy = cy;
    if (selected) {
      ctx.fillStyle = `rgba(120,220,210,${0.12 + flicker(time, 740 + i) * 0.08})`;
      ctx.fillRect(ox - 2 * sx, oy - 2 * sy, panelW - 12 * sx, rowH);
    }
    const color = option.enabled ? (selected ? snap.color : '#cfd') : '#667';
    ctx.font = `${(selected ? 8 : 7) * sy}px monospace`;
    drawGlitchText(ctx, `${selected ? '>' : ' '} ${fitText(ctx, option.label, panelW - 22 * sx)}`, ox, oy, time, 750 + i, color, 8 * sy);
    ctx.font = `${6 * sy}px monospace`;
    ctx.fillStyle = option.enabled ? '#899' : '#755';
    const detail = option.enabled ? option.detail : option.disabledReason ?? option.detail;
    ctx.fillText(fitText(ctx, detail, panelW - 22 * sx), ox + 8 * sx, oy + 10 * sy);
    cy += 22 * sy;
  }

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#8aa';
  ctx.fillText(fitText(ctx, snap.message, panelW - 16 * sx), x + 8 * sx, y + panelH - 17 * sy);
  ctx.fillStyle = '#586';
  ctx.fillText(fitText(ctx, `${controlHint('gameMenu')} принять  ${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} выбор  ${menuCloseHint()} уйти`, panelW - 16 * sx), x + 8 * sx, y + panelH - 8 * sy);
  ctx.restore();
}
