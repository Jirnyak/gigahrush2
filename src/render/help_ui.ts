/* ── One-page HELP poster (F1) ───────────────────────────────── */

import { type GameState } from '../core/types';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { drawGlitchText, drawNeuroPanel, flicker, textJitter } from './hud_fx';
import { fitTextStable, wrapTextLines } from './ui_text';

interface HelpLine {
  key: string;
  text: string;
}

interface HelpSection {
  title: string;
  lines: readonly HelpLine[];
}

function helpSections(): readonly HelpSection[] {
  const move = `${controlBindingLabel('moveForward')}/${controlBindingLabel('moveBackward')} + ${controlBindingLabel('strafeLeft')}/${controlBindingLabel('strafeRight')}`;
  const menuNav = `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')}/${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')}`;
  return [
    {
      title: 'ПЕРВЫЕ МИНУТЫ',
      lines: [
        { key: controlHint('interact'), text: 'двери, NPC, ящики, станки, терминалы и предметы под прицелом' },
        { key: controlHint('sprint'), text: 'короткий рывок; еда, вода, сон и раны давят на вылазку' },
        { key: 'САМОСБОР', text: 'увидели предупреждение - ищите укрытие или уходите к лифту' },
        { key: 'РЕШЕНИЕ', text: 'торгуйте, воруйте, чините, сопровождайте, убегайте; мир запоминает смерти' },
      ],
    },
    {
      title: 'ДВИЖЕНИЕ И БОЙ',
      lines: [
        { key: move, text: 'ходьба и стрейф; стрелки поворачивают, мышь ведет взгляд' },
        { key: controlHint('attack'), text: 'атака или выстрел выбранным оружием' },
        { key: controlHint('useTool'), text: 'инструмент в руках: луч, ремонт, очистка, спецэффекты' },
        { key: controlHint('sleep'), text: 'сон удержанием; восстанавливает не там, где безопасно' },
        { key: controlHint('pee'), text: 'нужды персонажа - часть выживания, не декорация' },
      ],
    },
    {
      title: 'ЭКРАНЫ',
      lines: [
        { key: controlHint('help'), text: 'этот HELP-плакат; повторное нажатие закрывает' },
        { key: controlHint('gameMenu'), text: 'пауза, сохранить, загрузить, быстрый вход в настройки' },
        { key: controlHint('controlsMenu'), text: 'полная таблица клавиш и переназначение' },
        { key: controlHint('uiSettings'), text: 'пресеты HUD, автоподбор, FOV, помехи и миникарта' },
        { key: controlHint('inventory'), text: 'инвентарь, предметы, очки характеристик' },
        { key: controlHint('quests'), text: 'задания; Enter ставит выбранную цель на карту' },
      ],
    },
    {
      title: 'КАРТА И ЖУРНАЛЫ',
      lines: [
        { key: controlHint('map'), text: 'большая карта; колесо меняет радиус обзора' },
        { key: controlHint('mapLegend'), text: 'слои карты, подписи, контрастная палитра' },
        { key: controlHint('factions'), text: 'отношения фракций и A-Life рейтинг живых людей' },
        { key: controlHint('log'), text: 'полный журнал услышанных сообщений и событий' },
        { key: controlHint('netSphere'), text: 'НЕТ-СФЕРА, чат и сетевые сводки, если сборка онлайн' },
      ],
    },
    {
      title: 'КАК ЧИТАТЬ HUD',
      lines: [
        { key: 'НИЗ', text: 'HP, PSI, голод, жажда, сон и выбранное оружие' },
        { key: 'ПРИЦЕЛ', text: 'имя цели, HP, quest-метки и подсказка действия' },
        { key: 'МИНИКАРТА', text: 'комнаты, лифты, предметы, враги, NPC и цель задания' },
        { key: 'СВОДКА', text: 'короткие события с временем и дистанцией; полный список в журнале' },
        { key: 'ЦВЕТА', text: 'зеленый дружелюбен, желтый нейтрален, красный опасен, синий/золото - квест' },
      ],
    },
    {
      title: 'МЕНЮ И БРАУЗЕР',
      lines: [
        { key: controlHint('gameMenu'), text: 'принять выбранную строку; ЛКМ делает то же в canvas-меню' },
        { key: menuNav, text: 'курсор, вкладки, суммы, карты и прокрутка меню' },
        { key: menuCloseHint(), text: 'назад или закрыть; Esc оставлен браузеру и pointer lock' },
        { key: controlHint('fullscreen'), text: 'полный экран; игра не включает его без вашего действия' },
        { key: 'MOBILE', text: 'экранная рельса открывает те же окна; HELP доступен из игрового меню' },
      ],
    },
  ];
}

function drawHelpLine(
  ctx: CanvasRenderingContext2D,
  line: HelpLine,
  x: number,
  y: number,
  w: number,
  keyW: number,
  lineH: number,
  s: number,
): number {
  ctx.font = `bold ${6.5 * s}px monospace`;
  ctx.fillStyle = '#0fa';
  ctx.fillText(fitTextStable(ctx, line.key, keyW), x, y);
  ctx.font = `${6.5 * s}px monospace`;
  ctx.fillStyle = '#b9d6d0';
  const lines = wrapTextLines(ctx, line.text, Math.max(24 * s, w - keyW - 6 * s), 2, { stable: true });
  const textX = x + keyW + 6 * s;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], textX, y + i * lineH);
  }
  return Math.max(1, lines.length) * lineH;
}

function drawHelpSection(
  ctx: CanvasRenderingContext2D,
  section: HelpSection,
  x: number,
  y: number,
  w: number,
  maxY: number,
  s: number,
  time: number,
  seed: number,
): number {
  const lineH = 8.6 * s;
  const keyW = Math.min(84 * s, Math.max(48 * s, w * 0.34));
  const titleJ = textJitter(time * 0.9, seed);
  ctx.font = `bold ${8 * s}px monospace`;
  ctx.fillStyle = '#6cf';
  ctx.fillText(fitTextStable(ctx, section.title, w), x + titleJ.dx, y + titleJ.dy);
  y += 11 * s;
  ctx.strokeStyle = `rgba(0,255,190,${0.22 + 0.12 * flicker(time, seed + 1)})`;
  ctx.beginPath();
  ctx.moveTo(x, y - 4 * s);
  ctx.lineTo(x + w, y - 4 * s);
  ctx.stroke();

  for (const line of section.lines) {
    if (y + lineH > maxY) break;
    y += drawHelpLine(ctx, line, x, y, w, keyW, lineH, s);
  }
  return y + 7 * s;
}

export function drawHelpMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sx: number,
  sy: number,
  uiTime = state.time,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const compact = w < 780 || h < 520;
  const s = Math.max(0.58, Math.min(1.7, Math.min(sx, sy) * (compact ? 0.84 : 1)));
  const margin = Math.max(6 * s, Math.min(16 * s, w * 0.025));
  const panelX = margin;
  const panelY = margin;
  const panelW = w - margin * 2;
  const panelH = h - margin * 2;
  const pad = 11 * s;
  const titleH = 31 * s;
  const footerH = 14 * s;
  const gap = 10 * s;
  const columns = w >= 560 ? 2 : 1;
  const colW = (panelW - pad * 2 - gap * (columns - 1)) / columns;
  const contentTop = panelY + pad + titleH;
  const contentBottom = panelY + panelH - pad - footerH;
  const sections = helpSections();
  const perColumn = Math.ceil(sections.length / columns);

  ctx.fillStyle = 'rgba(0,0,5,0.91)';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, panelX, panelY, panelW, panelH, uiTime, 1210);

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const titleJ = textJitter(uiTime, 1211);
  drawGlitchText(ctx, 'F1 // HELP', panelX + pad + titleJ.dx, panelY + pad + 11 * s + titleJ.dy, uiTime, 1212, '#0fa', 14 * s);
  ctx.font = `${6.6 * s}px monospace`;
  ctx.fillStyle = '#789';
  const subtitle = 'одностраничный плакат выживания: клавиши, экраны, HUD и браузерные правила';
  ctx.fillText(fitTextStable(ctx, subtitle, panelW - pad * 2), panelX + pad, panelY + pad + 24 * s);

  for (let col = 0; col < columns; col++) {
    let y = contentTop;
    const x = panelX + pad + col * (colW + gap);
    const start = col * perColumn;
    const end = Math.min(sections.length, start + perColumn);
    for (let i = start; i < end; i++) {
      y = drawHelpSection(ctx, sections[i], x, y, colW, contentBottom, s, uiTime, 1230 + i * 7);
    }
  }

  ctx.font = `${6.5 * s}px monospace`;
  ctx.fillStyle = '#567';
  const footer = `${controlHint('help')} закрыть HELP  |  ${menuCloseHint()} назад  |  ${controlHint('controlsMenu')} все бинды`;
  ctx.fillText(fitTextStable(ctx, footer, panelW - pad * 2), panelX + pad, panelY + panelH - pad);
  ctx.restore();
}
