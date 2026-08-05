import { Tex } from '../core/types';
import { drawTextCentered } from './text';
import { S, rgba, noise, clamp } from './pixutil';

const BG_R = 30, BG_G = 55, BG_B = 45;
const COL_KEY = rgba(255, 230, 80);
const COL_DESC = rgba(200, 215, 200);
const COL_BORDER = rgba(70, 110, 85);

const PAIRS: [string, string, string, string][] = [
  ['WASD', 'ХОДЬБА', 'МЫШЬ', 'ОБЗОР'],
  ['ЛКМ', 'АТАКА', 'E', 'ДЕЙСТВИЕ'],
  ['F', 'ФРАКЦИИ', 'I', 'ИНВЕНТАРЬ'],
  ['M', 'КАРТА', 'Q', 'ЗАДАНИЯ'],
  ['L', 'ЖУРНАЛ', 'N', 'НЕТ-СФЕРА'],
  ['P', 'ТУАЛЕТ', 'ENTER', 'МЕНЮ'],
  ['G', 'ИНСТРУМ.', '1 2 3', 'АТРИБУТЫ'],
];

function drawHLine(t: Uint32Array, y: number, col: number): void {
  const m = S >> 1;
  for (let d = 0; d <= 24; d++) {
    if (m - d >= 0) t[y * S + (m - d)] = col;
    if (m + d < S) t[y * S + (m + d)] = col;
  }
}

export function generateHintTextures(textures: Uint32Array[]): void {
  const HALF = S >> 1;
  for (let i = 0; i < 7; i++) {
    const t = textures[Tex.HINT_1 + i];
    const [k1, d1, k2, d2] = PAIRS[i];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const n = noise(x, y, 400 + i * 7) * 10 - 5;
        t[y * S + x] = rgba(
          clamp(BG_R + Math.floor(n)),
          clamp(BG_G + Math.floor(n)),
          clamp(BG_B + Math.floor(n)),
        );
      }
    for (let p = 0; p < S; p++) for (let b = 0; b < 2; b++) {
      t[b * S + p] = COL_BORDER;
      t[(S - 1 - b) * S + p] = COL_BORDER;
      t[p * S + b] = COL_BORDER;
      t[p * S + (S - 1 - b)] = COL_BORDER;
    }
    drawHLine(t, HALF, COL_BORDER);
    drawTextCentered(t, k1, 7, COL_KEY);
    drawTextCentered(t, d1, 19, COL_DESC);
    drawTextCentered(t, k2, HALF + 7, COL_KEY);
    drawTextCentered(t, d2, HALF + 19, COL_DESC);
  }
  {
    const t = textures[Tex.HINT_LORE];
    const LR = 45, LG = 15, LB = 15;
    const LBORDER = rgba(100, 30, 30);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const n = noise(x, y, 777) * 8 - 4;
        t[y * S + x] = rgba(
          clamp(LR + Math.floor(n)),
          clamp(LG + Math.floor(n)),
          clamp(LB + Math.floor(n)),
        );
      }
    for (let p = 0; p < S; p++) for (let b = 0; b < 2; b++) {
      t[b * S + p] = LBORDER;
      t[(S - 1 - b) * S + p] = LBORDER;
      t[p * S + b] = LBORDER;
      t[p * S + (S - 1 - b)] = LBORDER;
    }
    drawTextCentered(t, 'ПОМНИ', 4, COL_KEY);
    drawTextCentered(t, 'ОСНОВНЫЕ', 16, COL_DESC);
    drawTextCentered(t, 'КОМАНДЫ', 28, COL_DESC);
    drawTextCentered(t, 'НЕЙРО', 40, COL_DESC);
    drawTextCentered(t, 'ИНТЕРФЕЙСА', 52, COL_DESC);
  }
}
