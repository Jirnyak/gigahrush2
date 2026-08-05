import { TITLE_LANGUAGES, type TitleLanguageId, type TitleFlagKind, titleLanguageDef } from '../data/languages';
import { controlBindingLabel } from '../systems/controls';
import { fitText } from './ui_text';

export type TitleScreenMode = 'language' | 'setup' | 'feedback';
export type TitleHitField = 'language' | 'name' | 'age' | 'sex' | 'seed' | 'actorCap' | 'addNpc' | 'trailer' | 'start' | 'continue' | 'feedback';

export interface TitleLanguageHit {
  id?: TitleLanguageId;
  field?: TitleHitField;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TitleSetupRowView {
  field: TitleHitField;
  label: string;
  value: string;
  hint: string;
  selected: boolean;
}

export interface DrawTitleOptions {
  mode: TitleScreenMode;
  languageId: TitleLanguageId;
  playerName: string;
  runSeedText: string;
  setupRows: readonly TitleSetupRowView[];
  cursorOn: boolean;
  mobile: boolean;
}

export function hitTitleLanguage(hits: readonly TitleLanguageHit[], x: number, y: number): TitleLanguageId | null {
  for (const hit of hits) {
    if (!hit.id) continue;
    if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit.id;
  }
  return null;
}

export function hitTitleField(hits: readonly TitleLanguageHit[], x: number, y: number): TitleHitField | null {
  for (const hit of hits) {
    if (!hit.field) continue;
    if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit.field;
  }
  return null;
}

export function drawTitleScreen(ctx: CanvasRenderingContext2D, options: DrawTitleOptions): TitleLanguageHit[] {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const viewportScale = Math.min(w / 720, h / 520);
  const minScale = Math.min(0.72, Math.max(0.42, Math.min(w / 640, h / 360)));
  const s = Math.max(minScale, Math.min(1.35, viewportScale));
  const cx = w / 2;
  const cy = h / 2;
  const lang = titleLanguageDef(options.languageId);

  ctx.fillStyle = 'rgba(9, 9, 9, 0.65)';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#210006';
  for (let y = 0; y < h; y += 18 * s) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#c00';
  ctx.font = `bold ${Math.round(48 * s)}px monospace`;
  const titleY = options.mode === 'setup' ? cy - (options.setupRows.length > 7 ? 180 : 160) * s : cy - 122 * s;
  const subtitleY = options.mode === 'setup' ? cy - (options.setupRows.length > 7 ? 138 : 118) * s : cy - 76 * s;
  ctx.fillText(lang.title, cx, titleY);
  ctx.fillStyle = '#666';
  ctx.font = `${Math.round(16 * s)}px monospace`;
  ctx.fillText(lang.subtitle, cx, subtitleY);

  const hits = options.mode === 'setup'
    ? drawSetupMenu(ctx, cx, cy - (options.setupRows.length > 7 ? 124 : options.setupRows.length > 5 ? 104 : 48) * s, s, options)
    : options.mode === 'language'
      ? drawLanguageMenu(ctx, cx, cy - 44 * s, s, options.languageId)
      : [];

  ctx.fillStyle = '#555';
  ctx.font = `${Math.round(12 * s)}px monospace`;
  ctx.textAlign = 'center';
  if (options.mode === 'language') {
    if (options.mobile) {
      const hintY = Math.max(cy + 80 * s, h - 30 * s);
      ctx.fillText(fitText(ctx, lang.mobileHint, w * 0.92), cx, hintY);
    } else {
      const hintY = Math.max(cy + 80 * s, h - 40 * s);
      ctx.fillText(fitText(ctx, lang.desktopHint(
        controlBindingLabel('moveForward'),
        controlBindingLabel('interact'),
      ), w * 0.92), cx, hintY);
      ctx.fillText(fitText(ctx, lang.desktopCombatHint(
        controlBindingLabel('attack'),
        controlBindingLabel('fullscreen'),
        controlBindingLabel('controlsMenu'),
        controlBindingLabel('uiSettings'),
      ), w * 0.92), cx, hintY + 14 * s);
    }
  }

  ctx.fillStyle = '#705858';
  ctx.font = `${Math.round(11 * s)}px monospace`;
  if (options.mode !== 'setup') ctx.fillText(fitText(ctx, lang.languageHint, w * 0.9), cx, h - 12 * s);

  ctx.textAlign = 'left';
  if (typeof window !== 'undefined') {
    (window as any).__gigahrushTitleHits = hits;
  }
  return hits;
}

function drawLanguageMenu(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  s: number,
  languageId: TitleLanguageId,
): TitleLanguageHit[] {
  const lang = titleLanguageDef(languageId);
  const hits = drawLanguageSwitch(ctx, cx, y, s, languageId);
  const w = ctx.canvas.width;
  const fieldW = Math.min(w * 0.9, 460 * s);
  ctx.fillStyle = '#888';
  ctx.font = `${Math.round(16 * s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(fitText(ctx, lang.startPrompt, w * 0.9), cx, y + 94 * s);
  hits.push({ field: 'start', x: cx - fieldW / 2, y: y + 68 * s, w: fieldW, h: 40 * s });
  return hits;
}

function drawSetupMenu(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  s: number,
  options: DrawTitleOptions,
): TitleLanguageHit[] {
  const w = ctx.canvas.width;
  const lang = titleLanguageDef(options.languageId);
  const hits: TitleLanguageHit[] = [];
  const panelW = Math.min(w * 0.92, 560 * s);
  const rowH = Math.max(24, 28 * s);
  const gap = Math.max(3, 4 * s);
  const panelH = 64 * s + options.setupRows.length * rowH + Math.max(0, options.setupRows.length - 1) * gap + 24 * s;
  const x = cx - panelW / 2;
  const y = top;

  ctx.fillStyle = 'rgba(4,8,10,0.88)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = '#243b40';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#d6b24c';
  ctx.font = `bold ${Math.round(18 * s)}px monospace`;
  ctx.fillText(fitText(ctx, lang.setupTitle, panelW - 24 * s), cx, y + 24 * s);
  ctx.fillStyle = '#667';
  ctx.font = `${Math.round(10 * s)}px monospace`;
  ctx.fillText(fitText(ctx, lang.setupSubtitle, panelW - 24 * s), cx, y + 40 * s);

  let rowY = y + 56 * s;
  for (const row of options.setupRows) {
    const selected = row.selected;
    ctx.fillStyle = selected ? 'rgba(24,64,58,0.9)' : 'rgba(12,18,20,0.72)';
    ctx.fillRect(x + 10 * s, rowY, panelW - 20 * s, rowH);
    ctx.strokeStyle = selected ? '#00d49a' : '#23363a';
    ctx.strokeRect(x + 10 * s + 0.5, rowY + 0.5, panelW - 20 * s - 1, rowH - 1);

    ctx.textAlign = 'left';
    ctx.fillStyle = selected ? '#d8ffe8' : '#7b9a9a';
    ctx.font = `bold ${Math.round(11 * s)}px monospace`;
    ctx.fillText(fitText(ctx, `${selected ? '> ' : '  '}${row.label}`, panelW * 0.4), x + 18 * s, rowY + 13 * s);

    const commandRow = row.field === 'start' || row.field === 'addNpc';
    ctx.textAlign = commandRow ? 'center' : 'right';
    ctx.fillStyle = commandRow ? (selected ? '#ffd46a' : '#9a7b44') : (selected ? '#8fffd2' : '#698b88');
    ctx.font = `${Math.round(11 * s)}px monospace`;
    const valueMaxW = commandRow ? panelW - 52 * s : panelW * 0.48;
    const valueX = commandRow ? cx : x + panelW - 18 * s;
    ctx.fillText(fitText(ctx, row.value, valueMaxW), valueX, rowY + 13 * s);

    if (row.hint) {
      ctx.textAlign = 'left';
      ctx.fillStyle = selected ? '#668' : '#465';
      ctx.font = `${Math.round(8 * s)}px monospace`;
      ctx.fillText(fitText(ctx, row.hint, panelW - 40 * s), x + 18 * s, rowY + 24 * s);
    }

    hits.push({ field: row.field, x: x + 10 * s, y: rowY, w: panelW - 20 * s, h: rowH });
    rowY += rowH + gap;
  }

  ctx.fillStyle = '#555';
  ctx.font = `${Math.round(12 * s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(fitText(ctx, lang.setupControlHint, w * 0.92), cx, Math.max(y + panelH + 24 * s, w * 0.05 > 40 ? ctx.canvas.height - 30 * s : y + panelH + 24 * s));

  return hits;
}

function drawLanguageSwitch(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  s: number,
  activeId: TitleLanguageId,
): TitleLanguageHit[] {
  const chipW = 120 * s;
  const chipH = 44 * s;
  const gap = 10 * s;
  const totalW = TITLE_LANGUAGES.length * chipW + (TITLE_LANGUAGES.length - 1) * gap;
  const x0 = cx - totalW / 2;
  const hits: TitleLanguageHit[] = [];

  for (let i = 0; i < TITLE_LANGUAGES.length; i++) {
    const def = TITLE_LANGUAGES[i];
    const x = x0 + i * (chipW + gap);
    const active = def.id === activeId;
    ctx.fillStyle = active ? 'rgba(50,18,18,0.92)' : 'rgba(8,16,18,0.72)';
    ctx.strokeStyle = active ? '#d6b24c' : '#304a50';
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.fillRect(x, y, chipW, chipH);
    ctx.strokeRect(x + 0.5, y + 0.5, chipW - 1, chipH - 1);

    drawFlag(ctx, def.flag, x + 7 * s, y + 7 * s, 42 * s, 28 * s);
    ctx.textAlign = 'left';
    ctx.fillStyle = active ? '#ffd46a' : '#86a9ad';
    ctx.font = `bold ${Math.round(12 * s)}px monospace`;
    ctx.fillText(def.code, x + 56 * s, y + 18 * s);
    ctx.fillStyle = active ? '#d8c68a' : '#60777a';
    ctx.font = `${Math.round(9 * s)}px monospace`;
    ctx.fillText(fitText(ctx, def.name, chipW - 62 * s), x + 56 * s, y + 32 * s);
    hits.push({ id: def.id, x, y, w: chipW, h: chipH });
  }

  return hits;
}

function drawFlag(ctx: CanvasRenderingContext2D, kind: TitleFlagKind, x: number, y: number, w: number, h: number): void {
  if (kind === 'soviet') drawSovietFlag(ctx, x, y, w, h);
  else drawBritishEmpireFlag(ctx, x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawSovietFlag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#b00018';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(x, y + h * 0.64, w, h * 0.36);
  ctx.fillStyle = '#ffd75a';
  drawStar(ctx, x + w * 0.26, y + h * 0.22, h * 0.11);

  ctx.save();
  ctx.fillStyle = '#ffd75a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(h * 0.74)}px "Arial Unicode MS", "Apple Symbols", "Noto Sans Symbols", sans-serif`;
  ctx.fillText('☭', x + w * 0.47, y + h * 0.61);
  ctx.restore();
}

function drawBritishEmpireFlag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#102a68';
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = h * 0.25;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.strokeStyle = '#c8102e';
  ctx.lineWidth = h * 0.12;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = h * 0.34;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.strokeStyle = '#c8102e';
  ctx.lineWidth = h * 0.18;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
