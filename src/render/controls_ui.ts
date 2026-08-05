import { type GameState } from '../core/types';
import {
  CONTROL_ACTIONS,
  controlBindingLabel,
  controlHint,
  getControlCaptureAction,
  menuCloseHint,
} from '../systems/controls';
import { MOBILE_BUTTON_CONTROL_ROWS } from '../systems/mobile_actions';
import {
  MOUSE_LOOK_SENSITIVITY_MAX,
  MOUSE_LOOK_SENSITIVITY_MIN,
  mouseLookSensitivity,
} from '../systems/ui_orchestrator';
import { drawNeuroPanel, drawGlitchText, flicker, textJitter } from './hud_fx';
import { fitText } from './ui_text';

function mouseSensitivitySliderText(): string {
  const value = mouseLookSensitivity();
  const pct = Math.round(value * 100);
  const segments = 12;
  const t = Math.max(0, Math.min(1, (value - MOUSE_LOOK_SENSITIVITY_MIN) / (MOUSE_LOOK_SENSITIVITY_MAX - MOUSE_LOOK_SENSITIVITY_MIN)));
  const filled = Math.max(0, Math.min(segments, Math.round(t * segments)));
  return `[${'#'.repeat(filled)}${'-'.repeat(segments - filled)}] ${pct}%`;
}

export function drawControlsMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sx: number,
  sy: number,
  uiTime = state.time,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const time = uiTime;
  const isButtons = state.controlView === 'buttons';
  const rowCount = isButtons ? MOBILE_BUTTON_CONTROL_ROWS.length : CONTROL_ACTIONS.length + 2;
  const rowH = 12 * sy;
  const top = 44 * sy;
  const bottom = h - 24 * sy;
  const visible = Math.max(4, Math.floor((bottom - top) / rowH));
  const maxScroll = Math.max(0, rowCount - visible);
  const scroll = Math.max(0, Math.min(maxScroll, state.controlScroll));
  const selected = Math.max(0, Math.min(rowCount - 1, state.controlSel));
  const capture = isButtons ? null : getControlCaptureAction();
  const prevTextBaseline = ctx.textBaseline;

  ctx.fillStyle = '#00040a';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, 4 * sx, 4 * sy, w - 8 * sx, h - 8 * sy, time, 1140);

  ctx.textBaseline = 'alphabetic';
  const titleJ = textJitter(time, 1141);
  drawGlitchText(ctx, isButtons ? 'КНОПКИ' : 'ГОРЯЧИЕ КЛАВИШИ', 12 * sx + titleJ.dx, 12 * sy + titleJ.dy, time, 1142, '#6cf', 11 * sy);
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#577';
  ctx.fillText(
    fitText(ctx, isButtons
      ? `${menuCloseHint()} закрыть`
      : `${controlHint('gameMenu')} принять/изменить  |  ${menuCloseHint()} закрыть  |  Backspace очистить строку  |  ←/→ слайдер`,
    w - 24 * sx),
    12 * sx,
    26 * sy,
  );

  const x = 10 * sx;
  const groupW = Math.min(86 * sx, w * 0.24);
  const keyW = Math.min(150 * sx, w * 0.38);
  const labelW = Math.max(40 * sx, w - x * 2 - groupW - keyW - 12 * sx);

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#345';
  ctx.fillText('РАЗДЕЛ', x + 14 * sx, top - 7 * sy);
  ctx.fillText('ДЕЙСТВИЕ', x + groupW + 18 * sx, top - 7 * sy);
  ctx.fillText(isButtons ? 'КНОПКА' : 'КЛАВИШИ / ЗНАЧЕНИЕ', x + groupW + labelW + 20 * sx, top - 7 * sy);

  ctx.textBaseline = 'middle';
  for (let row = 0; row < visible; row++) {
    const i = scroll + row;
    if (i >= rowCount) break;
    const isReset = !isButtons && i === 0;
    const action = isButtons || isReset ? undefined : CONTROL_ACTIONS[i - 1];
    const button = isButtons ? MOBILE_BUTTON_CONTROL_ROWS[i] : undefined;
    const isMouseSensitivity = !isButtons && i === CONTROL_ACTIONS.length + 1;
    if (isButtons) {
      if (!button) break;
    } else if (!isReset && !action && !isMouseSensitivity) {
      break;
    }
    const rowY = top + row * rowH;
    const textY = rowY + rowH * 0.5;
    const isSel = i === selected;
    const isCapture = !isButtons && !!action && capture === action.id;

    if (isSel) {
      ctx.fillStyle = `rgba(0,90,78,${0.46 + 0.12 * flicker(time, 1145 + i)})`;
      ctx.fillRect(x - 2 * sx, rowY, w - x * 2 + 4 * sx, rowH);
      ctx.strokeStyle = isCapture || isMouseSensitivity ? '#fd6' : 'rgba(0,255,190,0.46)';
      ctx.strokeRect(x - 2 * sx + 0.5, rowY + 0.5, w - x * 2 + 4 * sx - 1, rowH - 1);
    }

    ctx.fillStyle = isSel ? '#0fa' : '#6a8';
    ctx.fillText(isSel ? '▶' : ' ', x, textY);
    ctx.fillStyle = '#689';
    const group = isButtons ? button?.group ?? '' : isReset ? 'Сервис' : isMouseSensitivity ? 'Мышь' : action?.group ?? '';
    const label = isButtons ? button?.label ?? '' : isReset ? 'Вернуть дефолты' : isMouseSensitivity ? 'Чувствительность мыши' : action?.label ?? '';
    ctx.fillText(fitText(ctx, group, groupW - 10 * sx), x + 14 * sx, textY);
    ctx.fillStyle = isSel ? '#dff' : '#9bb';
    ctx.fillText(fitText(ctx, label, labelW - 8 * sx), x + groupW + 18 * sx, textY);
    ctx.fillStyle = isCapture || isMouseSensitivity ? '#fd6' : isSel ? '#fff' : '#9cb';
    const keys = isButtons
      ? button?.binding ?? ''
      : isMouseSensitivity
        ? mouseSensitivitySliderText()
        : isReset
          ? 'ENTER'
        : isCapture
          ? 'НАЖМИТЕ КЛАВИШУ...'
          : action ? controlBindingLabel(action.id) : '';
    ctx.fillText(fitText(ctx, keys, keyW - 4 * sx), x + groupW + labelW + 20 * sx, textY);
  }

  if (rowCount > visible) {
    const barX = w - 10 * sx;
    const barY = top;
    const barH = visible * rowH;
    const thumbH = Math.max(8 * sy, barH * (visible / rowCount));
    const thumbY = barY + (barH - thumbH) * (scroll / Math.max(1, maxScroll));
    ctx.fillStyle = '#123';
    ctx.fillRect(barX, barY, 3 * sx, barH);
    ctx.fillStyle = '#587';
    ctx.fillRect(barX, thumbY, 3 * sx, thumbH);
  }

  ctx.fillStyle = capture ? '#fd6' : '#456';
  ctx.font = `${7 * sy}px monospace`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    capture
      ? 'Нажатая клавиша или кнопка мыши добавится к действию. Space, Backspace и Esc тоже назначаются.'
      : isButtons
        ? 'Экранные кнопки и мобильная рельса живут отдельно от клавиатурных биндов.'
        : 'Клавиши можно повторять между действиями. Backspace очищает выбранное действие; верхняя строка Enter возвращает дефолты.',
    12 * sx,
    h - 10 * sy,
  );
  ctx.textBaseline = prevTextBaseline;
}
