import { type GameState } from '../core/types';
import { controlBindingLabel, menuCloseHint } from '../systems/controls';
import { drawNeuroPanel, textJitter, flicker } from './hud_fx';
import { fitText } from './ui_text';

const QR_CODE = [
  "1111111010101100101111111",
  "1000001001111010101000001",
  "1011101011100100101011101",
  "1011101011101011001011101",
  "1011101010011101101011101",
  "1000001000110010001000001",
  "1111111010101010101111111",
  "0000000000101001100000000",
  "1111001010111010110011101",
  "1101000010101010100000010",
  "0011101001111110101010000",
  "1001110011100100101001100",
  "0111011101101110011110111",
  "0011110101011001111110001",
  "0110111000110110011010110",
  "1001100011110010111110001",
  "0010001001001100111111111",
  "0000000010000110100010101",
  "1111111000000100101010111",
  "1000001000110001100010001",
  "1011101001000010111111010",
  "1011101011000100111011111",
  "1011101010100011111010110",
  "1000001011111100010010100",
  "1111111011011001011111111"
];

const CREDITS = [
  "Николай Романов",
  "Семён Семёныч Персиков",
  "Klaus Schwab"
];

export function drawFeedbackMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  _sx: number, sy: number,
  uiTime = state.time,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const time = uiTime;

  // Darken background
  ctx.fillStyle = 'rgba(0,0,4,0.85)';
  ctx.fillRect(0, 0, w, h);

  // Panel
  const pw = Math.min(w - 32 * _sx, 480 * _sx);
  const ph = Math.min(h - 32 * sy, 280 * sy);
  const px = (w - pw) / 2;
  const py = (h - ph) / 2;
  drawNeuroPanel(ctx, px, py, pw, ph, time, 80);

  // Title
  ctx.save();
  ctx.shadowColor = 'rgba(200,0,0,0.5)';
  ctx.shadowBlur = 10;
  const tj = textJitter(time, 800);
  ctx.fillStyle = `rgba(200,0,0,${flicker(time, 801)})`;
  ctx.font = `bold ${16 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('ОБРАТНАЯ СВЯЗЬ И ТИТРЫ', w / 2 + tj.dx, py + 24 * sy + tj.dy);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Left side - Credits
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8ab';
  ctx.font = `bold ${11 * sy}px monospace`;
  ctx.fillText('Команда (Титры):', px + 24 * _sx, py + 56 * sy);
  
  ctx.fillStyle = '#578';
  ctx.font = `${9 * sy}px monospace`;
  for (let i = 0; i < CREDITS.length; i++) {
    ctx.fillText(CREDITS[i], px + 24 * _sx, py + 72 * sy + i * 14 * sy);
  }

  // Right side - QR Code
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8ab';
  ctx.font = `bold ${11 * sy}px monospace`;
  ctx.fillText('Telegram:', px + pw - 24 * _sx, py + 56 * sy);

  const qrSize = QR_CODE.length;
  const pixelSize = Math.floor(4 * _sx);
  const qrW = qrSize * pixelSize;
  const qrX = px + pw - 24 * _sx - qrW;
  const qrY = py + 64 * sy;

  // Draw QR code background
  ctx.fillStyle = '#fff';
  ctx.fillRect(qrX - 4 * _sx, qrY - 4 * sy, qrW + 8 * _sx, qrW + 8 * sy);

  // Draw QR code blocks
  ctx.fillStyle = '#000';
  for (let r = 0; r < qrSize; r++) {
    for (let c = 0; c < qrSize; c++) {
      if (QR_CODE[r][c] === '1') {
        ctx.fillRect(qrX + c * pixelSize, qrY + r * pixelSize, pixelSize, pixelSize);
      }
    }
  }

  ctx.fillStyle = '#578';
  ctx.font = `${9 * sy}px monospace`;
  ctx.fillText('https://t.me/gigah_rush', px + pw - 24 * _sx, qrY + qrW + 16 * sy);

  // Bottom - Thank you message
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(0,255,170,${flicker(time, 810)})`;
  ctx.font = `bold ${10 * sy}px monospace`;
  ctx.fillText('Спасибо за то, что играете в гигахрущ!', w / 2, py + ph - 32 * sy);

  // Controls
  ctx.fillStyle = '#456';
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillText(
    fitText(ctx, `${controlBindingLabel('gameMenu')} — открыть ссылки  |  ${menuCloseHint()} — закрыть`, pw - 12 * _sx),
    w / 2,
    py + ph - 12 * sy,
  );

  ctx.textAlign = 'left';
}
