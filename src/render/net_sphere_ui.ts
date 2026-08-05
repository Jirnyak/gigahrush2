import { type NetSphereSnapshot } from '../systems/net_sphere';
import { controlHint } from '../systems/controls';
import { drawGlitchText, drawNeuroPanel, drawStaticNoise } from './hud_fx';
import { fitText, wrapTextLines } from './ui_text';

function two(value: number): string {
  return String(value).padStart(2, '0');
}

function timeLabel(epochMs: number): string {
  if (!epochMs) return '--/--/---- --:--';
  const date = new Date(epochMs);
  const day = two(date.getDate());
  const month = two(date.getMonth() + 1);
  const year = date.getFullYear();
  return `${day}/${month}/${year} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function statLine(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  valueOffset: number,
  tint = '#8cf',
): void {
  const valueX = x + valueOffset;
  ctx.fillStyle = '#6f7d88';
  ctx.fillText(fitText(ctx, label, valueOffset - 4), x, y);
  ctx.fillStyle = tint;
  ctx.fillText(fitText(ctx, value, w - valueOffset), valueX, y);
}

type ChatVisualLine = {
  kind: 'compact_label' | 'compact_body' | 'line';
  label: string;
  labelW: number;
  body: string;
};

export function drawNetSphereMenu(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  net: NetSphereSnapshot,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const s = Math.max(0.8, Math.min(2, Math.min(sx, sy)));
  const pad = 8 * s;
  const x = 5 * s;
  const y = 5 * s;
  const panelW = Math.max(1, w - 10 * s);
  const panelH = Math.max(1, h - 10 * s);
  const leftW = Math.min(210 * s, panelW * 0.38);
  const chatX = x + pad + leftW + 8 * s;
  const chatW = Math.max(1, x + panelW - chatX - pad);
  const headerY = y + 10 * s;
  const chatY = headerY + 2 * s;
  const chatH = Math.max(1, y + panelH - chatY - 18 * s);
  const commandY = y + panelH - 29 * s;
  const valueOffset = Math.max(58 * s, Math.min(132 * s, leftW * 0.5));
  const lineH = 9 * s;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 820);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, net.status === 'online' ? 0.012 : 0.026);
  ctx.beginPath();
  ctx.rect(x, y, panelW, panelH);
  ctx.clip();

  ctx.textBaseline = 'top';
  ctx.font = `bold ${12 * s}px monospace`;
  drawGlitchText(ctx, 'НЕТ-СФЕРА', x + pad, headerY, time, 821, '#63f6ff', 12 * s);
  ctx.font = `${7 * s}px monospace`;
  ctx.fillStyle = net.status === 'online' ? '#7f8' : net.status === 'syncing' ? '#fd6' : '#f86';
  ctx.fillText(net.statusText, x + pad, headerY + 16 * s);
  if (net.busy) {
    ctx.fillStyle = '#89a';
    ctx.fillText('пакет', x + pad + 75 * s, headerY + 16 * s);
  }

  const leftX = x + pad;
  let ly = headerY + 34 * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(leftX, ly - 2 * s, Math.max(1, leftW), Math.max(1, commandY + 22 * s - ly));
  ctx.clip();
  ctx.font = `${8 * s}px monospace`;
  statLine(ctx, 'НЕТ-ИМЯ', net.nickname, leftX, ly, leftW, valueOffset, '#d8f6ff'); ly += 12 * s;
  statLine(ctx, 'НЕТ-ГЕН', net.netGen, leftX, ly, leftW, valueOffset, '#7da3ad'); ly += 10 * s;
  statLine(ctx, 'СЕССИЯ', net.sessionId, leftX, ly, leftW, valueOffset, '#6f8792'); ly += 14 * s;

  const stats = net.stats;
  statLine(ctx, 'онлайн', String(stats?.onlineUsers ?? '-'), leftX, ly, leftW, valueOffset, '#7f8'); ly += 10 * s;
  statLine(ctx, 'всего', String(stats?.totalPlayers ?? '-'), leftX, ly, leftW, valueOffset, '#8cf'); ly += 10 * s;
  statLine(ctx, 'самосборов', String(stats?.totalSamosbors ?? '-'), leftX, ly, leftW, valueOffset, '#f6c'); ly += 10 * s;
  statLine(ctx, 'смертей', String(stats?.totalDeaths ?? '-'), leftX, ly, leftW, valueOffset, '#f86'); ly += 16 * s;

  const profile = net.profile;
  statLine(ctx, 'запусков', String(profile?.runs ?? '-'), leftX, ly, leftW, valueOffset, '#8cf'); ly += 10 * s;
  statLine(ctx, 'лучшее', profile ? `ур.${profile.bestLevel} / ${profile.bestSamosborCount} сб.` : '-', leftX, ly, leftW, valueOffset, '#fd8'); ly += 10 * s;
  statLine(ctx, 'мой этаж', profile?.lastFloor || '-', leftX, ly, leftW, valueOffset, '#9df'); ly += 10 * s;
  const runSeed = profile?.runSeed ?? net.currentRunSeed;
  statLine(ctx, 'сид мира', runSeed !== undefined ? String(runSeed) : '-', leftX, ly, leftW, valueOffset, '#8fb'); ly += 10 * s;
  statLine(ctx, 'мои смерти', String(profile?.deaths ?? '-'), leftX, ly, leftW, valueOffset, '#f98'); ly += 16 * s;

  ctx.fillStyle = '#9cf';
  ctx.fillText('СВОДКА', leftX, ly);
  ly += 10 * s;
  const maxEventRows = Math.max(0, Math.min(5, Math.floor((commandY - ly - 18 * s) / lineH)));
  for (const event of net.events.slice(0, maxEventRows)) {
    const color = event.type === 'death' ? '#f98' : '#f6c';
    ctx.fillStyle = color;
    ctx.fillText(fitText(ctx, event.summary, leftW - 8 * s), leftX, ly);
    ly += lineH;
  }

  if (net.error) {
    ly += 6 * s;
    ctx.fillStyle = '#f86';
    const maxErrorRows = Math.max(0, Math.floor((commandY - ly) / lineH));
    for (const line of wrapTextLines(ctx, net.error, leftW - pad, Math.min(4, maxErrorRows))) {
      ctx.fillText(line, leftX, ly);
      ly += lineH;
    }
  }

  ctx.fillStyle = '#607080';
  ctx.fillText(fitText(ctx, '/netgen NET-...  /new  /clear', leftW), leftX, commandY);
  ctx.fillStyle = '#607080';
  ctx.fillText(fitText(ctx, `${controlHint('netSphere')} открыть/закрыть  ПКМ/${controlHint('netClose')} закрыть  ${controlHint('netSubmit')} чат/отправить  ${controlHint('netErase')} стереть`, leftW), leftX, commandY + 10 * s);
  ctx.restore();

  ctx.strokeStyle = 'rgba(92,246,255,0.34)';
  ctx.strokeRect(chatX, chatY, chatW, chatH);
  ctx.fillStyle = 'rgba(3,18,24,0.58)';
  ctx.fillRect(chatX + 1, chatY + 1, chatW - 2, chatH - 2);

  ctx.font = `${8 * s}px monospace`;
  ctx.fillStyle = '#9cf';
  ctx.fillText('ТЕРМИНАЛ', chatX + 6 * s, chatY + 5 * s);
  ctx.fillStyle = '#607080';
  ctx.font = `${6 * s}px monospace`;
  const scrollHint = net.chat.length > 1
    ? `колесо PgUp/PgDn листать ${Math.min(net.chatScroll, Math.max(0, net.chat.length - 1)) + 1}/${net.chat.length}`
    : 'история пуста';
  ctx.fillText(fitText(ctx, scrollHint, Math.max(20 * s, chatW - 78 * s)), chatX + 72 * s, chatY + 6 * s);

  const promptH = Math.min(18 * s, Math.max(10 * s, chatH * 0.42));
  const msgTop = chatY + 20 * s;
  const msgBottom = Math.max(msgTop, chatY + chatH - promptH - 4 * s);
  ctx.font = `${7 * s}px monospace`;
  const compactChat = chatW < 180 * s;
  const messageEnds: number[] = [];
  const vlines: ChatVisualLine[] = [];
  for (let i = 0; i < net.chat.length; i++) {
    const line = net.chat[i];
    const stamp = timeLabel(line.createdAt);
    const name = line.nickname || 'Жилец';
    const nameW = Math.max(24 * s, Math.min(96 * s, chatW * 0.3));
    const label = `[${stamp} ${fitText(ctx, name, nameW)}]`;
    const labelW = ctx.measureText(label).width;
    if (compactChat) {
      const bodyW = Math.max(20 * s, chatW - 16 * s);
      vlines.push({ kind: 'compact_label', label: fitText(ctx, label, chatW - 12 * s), labelW, body: '' });
      for (const body of wrapTextLines(ctx, line.body, bodyW, 3)) {
        vlines.push({ kind: 'compact_body', label: '', labelW: 0, body });
      }
    } else {
      const bodyW = Math.max(20 * s, chatW - 16 * s - labelW);
      const wrapped = wrapTextLines(ctx, line.body, bodyW, 3);
      for (let j = 0; j < wrapped.length; j++) {
        vlines.push({ kind: 'line', label: j === 0 ? label : '', labelW, body: wrapped[j] });
      }
    }
    messageEnds[i] = vlines.length;
  }

  const visibleLines = Math.max(1, Math.floor((msgBottom - msgTop) / lineH));
  const maxChatScroll = Math.max(0, net.chat.length - 1);
  const chatScroll = Math.max(0, Math.min(maxChatScroll, Math.floor(net.chatScroll)));
  const anchorMessage = Math.max(0, net.chat.length - 1 - chatScroll);

  let endLine = Math.max(0, messageEnds[anchorMessage] ?? vlines.length);
  let startLine = Math.max(0, endLine - visibleLines);
  if (startLine === 0) {
    endLine = Math.min(vlines.length, visibleLines);
  }

  const drawnLines = Math.max(0, endLine - startLine);
  const firstLineY = Math.max(msgTop, msgBottom - drawnLines * lineH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(chatX + 2 * s, msgTop, Math.max(1, chatW - 4 * s), Math.max(1, msgBottom - msgTop));
  ctx.clip();
  if (vlines.length === 0) {
    ctx.fillStyle = '#51616b';
    ctx.fillText('Линия молчит.', chatX + 8 * s, msgTop + 2 * s);
  }
  for (let i = startLine; i < endLine; i++) {
    const line = vlines[i];
    const yLine = firstLineY + (i - startLine) * lineH;
    if (line.kind === 'compact_label') {
      ctx.fillStyle = '#6b7f8a';
      ctx.fillText(line.label, chatX + 6 * s, yLine);
      continue;
    }
    if (line.kind === 'compact_body') {
      ctx.fillStyle = '#d6f6ee';
      ctx.fillText(line.body, chatX + 10 * s, yLine);
      continue;
    }
    if (line.label) {
      ctx.fillStyle = '#6b7f8a';
      ctx.fillText(line.label, chatX + 6 * s, yLine);
    }
    ctx.fillStyle = '#d6f6ee';
    ctx.fillText(line.body, chatX + 9 * s + line.labelW, yLine);
  }

  if (maxChatScroll > 0) {
    const trackH = Math.max(1, msgBottom - msgTop - 2 * s);
    const trackX = chatX + chatW - 6 * s;
    const trackY = msgTop + 1 * s;
    ctx.fillStyle = 'rgba(35,55,65,0.78)';
    ctx.fillRect(trackX, trackY, 2 * s, trackH);
    const thumbH = Math.max(7 * s, trackH / Math.min(net.chat.length, 12));
    const pct = chatScroll / Math.max(1, maxChatScroll);
    const thumbY = trackY + (1 - pct) * (trackH - thumbH);
    ctx.fillStyle = '#63f6ff';
    ctx.fillRect(trackX, thumbY, 2 * s, thumbH);
  }
  ctx.restore();

  const promptY = Math.max(chatY + 2 * s, chatY + chatH - promptH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(chatX + 2 * s, promptY, Math.max(1, chatW - 4 * s), Math.max(1, chatY + chatH - promptY));
  ctx.clip();
  ctx.fillStyle = net.chatInputActive ? 'rgba(0,36,44,0.7)' : 'rgba(0,0,0,0.42)';
  ctx.fillRect(chatX + 2 * s, promptY, Math.max(1, chatW - 4 * s), Math.max(1, promptH - 2 * s));
  ctx.strokeStyle = net.chatInputActive ? 'rgba(99,246,255,0.8)' : 'rgba(99,246,255,0.22)';
  ctx.strokeRect(chatX + 2.5 * s, promptY + 0.5 * s, Math.max(1, chatW - 5 * s), Math.max(1, promptH - 3 * s));
  ctx.fillStyle = net.chatInputActive ? '#63f6ff' : '#54727d';
  const cursor = net.chatInputActive && Math.floor(time * 2) % 2 === 0 ? '_' : '';
  const draft = net.chatInputActive || net.draft ? net.draft + cursor : `${controlHint('netSubmit')} выбрать чат`;
  ctx.fillText(`> ${fitText(ctx, draft, chatW - 14 * s)}`, chatX + 6 * s, promptY + 5 * s);
  ctx.restore();

  ctx.restore();
}
