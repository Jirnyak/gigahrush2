import { type FastElevatorOverlaySnapshot } from '../systems/fast_elevator';
import { drawNeuroPanel, drawStaticNoise } from './hud_fx';
import { controlHint, menuCloseHint } from '../systems/controls';
import type { Entity } from '../core/types';

function fitHudText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let len = text.length;
  while (len > 1 && ctx.measureText(text.substring(0, len) + '...').width > maxW) {
    len--;
  }
  return text.substring(0, len) + '...';
}

export function drawFastElevatorOverlay(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  snapshot: FastElevatorOverlaySnapshot,
  _player: Entity,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const s = Math.max(0.78, Math.min(2.2, Math.min(sx, sy)));
  
  const panelW = Math.min(w - 24 * s, 260 * s);
  const panelH = Math.min(h - 24 * s, 180 * s);
  const x = (w - panelW) * 0.5;
  const y = (h - panelH) * 0.5;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, w, h);
  drawStaticNoise(ctx, 0, 0, w, h, time, 0.02);
  
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 7200);
  ctx.strokeStyle = 'rgba(80, 200, 255, 0.6)';
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);

  // Title
  ctx.shadowColor = '#4cf';
  ctx.shadowBlur = 8 * s;
  ctx.fillStyle = '#bff';
  ctx.font = `bold ${Math.round(14 * s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(fitHudText(ctx, 'СКОРОСТНОЙ ЛИФТ', panelW - 16 * s), w * 0.5, y + 16 * s);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#6a8';
  ctx.font = `${Math.round(8 * s)}px monospace`;
  ctx.fillText(fitHudText(ctx, 'выбор уровня доступа', panelW - 16 * s), w * 0.5, y + 28 * s);

  ctx.strokeStyle = 'rgba(80, 200, 255, 0.3)';
  ctx.beginPath();
  ctx.moveTo(x + 12 * s, y + 36 * s);
  ctx.lineTo(x + panelW - 12 * s, y + 36 * s);
  ctx.stroke();

  // Draw floors
  ctx.textAlign = 'left';
  const startY = y + 50 * s;
  const rowH = 16 * s;

  const visibleCount = 7;
  const halfVisible = Math.floor(visibleCount / 2);
  let startIndex = Math.max(0, snapshot.selectedIndex - halfVisible);
  if (startIndex + visibleCount > snapshot.availableFloors.length) {
    startIndex = Math.max(0, snapshot.availableFloors.length - visibleCount);
  }
  const endIndex = Math.min(snapshot.availableFloors.length, startIndex + visibleCount);

  for (let i = startIndex; i < endIndex; i++) {
    const floor = snapshot.availableFloors[i];
    const isSelected = i === snapshot.selectedIndex;
    const isUnlocked = true;
    
    const displayIdx = i - startIndex;
    const rowY = startY + displayIdx * rowH;
    const label = snapshot.floorLabels?.[i] ?? `Этаж ${floor}`;
    
    if (isSelected) {
      ctx.fillStyle = 'rgba(80, 200, 255, 0.15)';
      ctx.fillRect(x + 12 * s, rowY - 8 * s, panelW - 24 * s, rowH);
      ctx.strokeStyle = 'rgba(80, 200, 255, 0.8)';
      ctx.strokeRect(x + 12 * s + 0.5, rowY - 8 * s + 0.5, panelW - 24 * s - 1, rowH - 1);
    }

    ctx.font = `${Math.round(10 * s)}px monospace`;
    if (!isUnlocked) {
      ctx.fillStyle = isSelected ? '#a44' : '#644';
      ctx.fillText(fitHudText(ctx, `[НЕДОСТУПНО] Этаж ${floor > 0 ? '+' : ''}${floor}`, panelW - 32 * s), x + 20 * s, rowY);
    } else {
      ctx.fillStyle = isSelected ? '#fff' : '#8ac';
      ctx.shadowColor = isSelected ? '#8cf' : 'transparent';
      ctx.shadowBlur = isSelected ? 4 * s : 0;
      ctx.fillText(fitHudText(ctx, label, panelW - 32 * s), x + 20 * s, rowY);
      ctx.shadowBlur = 0;
    }
  }

  // Draw message
  if (snapshot.message) {
    ctx.textAlign = 'center';
    ctx.fillStyle = snapshot.message.includes('НЕДОСТУПНО') || snapshot.message.includes('уже') ? '#f44' : '#4f8';
    ctx.font = `${Math.round(8 * s)}px monospace`;
    ctx.fillText(fitHudText(ctx, snapshot.message, panelW - 24 * s), w * 0.5, y + panelH - 24 * s);
  }

  // Footer controls
  ctx.textAlign = 'center';
  ctx.fillStyle = '#577';
  ctx.font = `${Math.round(7 * s)}px monospace`;
  ctx.fillText(fitHudText(ctx, `W/S выбор   ${controlHint('gameMenu')} ехать   ${menuCloseHint()} выйти`, panelW - 16 * s), w * 0.5, y + panelH - 8 * s);

  ctx.restore();
}
