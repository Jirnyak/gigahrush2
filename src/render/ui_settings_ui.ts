import { type GameState } from '../core/types';
import { controlHint, menuCloseHint } from '../systems/controls';
import {
  activeUiPresetId,
  autoPickupEnabled,
  cameraFovDegrees,
  hudMotionMode,
  mapHighContrastEnabled,
  mobileLookSensitivity,
  screenInterferenceMode,
  uiElementEnabled,
  uiSettingsRowAt,
  uiSettingsRowCount,
  visualGeometryMode,
  lightingQualityMode,
  crittersEnabled,
} from '../systems/ui_orchestrator';
import { drawNeuroPanel, flicker } from './hud_fx';
import { fitTextStable } from './ui_text';

export function drawUiSettingsMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sx: number,
  sy: number,
  uiTime = state.time,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const time = uiTime;
  const view = state.uiSettingsView ?? 'interface';
  const rowH = 12 * sy;
  const top = 44 * sy;
  const bottom = h - 24 * sy;
  const visible = Math.max(4, Math.floor((bottom - top) / rowH));
  const rowCount = uiSettingsRowCount(view);
  const maxScroll = Math.max(0, rowCount - visible);
  const scroll = Math.max(0, Math.min(maxScroll, state.uiSettingsScroll));
  const selected = Math.max(0, Math.min(rowCount - 1, state.uiSettingsSel));
  const activePreset = activeUiPresetId();
  const prevTextBaseline = ctx.textBaseline;
  const graphicsValue = (kind: string): string => {
    if (kind === 'screen_interference') {
      const mode = screenInterferenceMode();
      if (!uiElementEnabled('screen_fx')) return 'ОТКЛ';
      return mode === 'off' ? 'ВЫКЛ' : mode === 'full' ? 'ПОЛН' : 'СЛАБ';
    }
    if (kind === 'hud_motion') return hudMotionMode() === 'reduced' ? 'МЕНЬШЕ' : 'НОРМ';
    if (kind === 'critters') return crittersEnabled() ? 'ВКЛ' : 'ВЫКЛ';
    if (kind === 'visual_geometry') {
      const mode = visualGeometryMode();
      return mode === 'off' ? 'ВЫКЛ' : mode === 'low' ? 'НИЗК' : mode === 'medium' ? 'СРЕД' : 'ВЫС';
    }
    if (kind === 'lighting_quality') {
      const mode = lightingQualityMode();
      return mode === 'off' ? 'ВЫКЛ' : mode === 'low' ? 'НИЗК' : mode === 'medium' ? 'СРЕД' : mode === 'high' ? 'ВЫС' : 'МАКС';
    }
    if (kind === 'map_contrast') return mapHighContrastEnabled() ? 'ВКЛ' : 'ВЫКЛ';
    if (kind === 'camera_fov') {
      const fov = cameraFovDegrees();
      const label = fov < 80 ? 'узко' : fov > 95 ? 'шир' : 'норм';
      return `${fov}° ${label}`;
    }
    return '';
  };

  ctx.fillStyle = '#00040a';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, 4 * sx, 4 * sy, w - 8 * sx, h - 8 * sy, time, 1240);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#6cf';
  ctx.font = `${11 * sy}px monospace`;
  ctx.fillText(view === 'graphics' ? 'НАСТРОЙКИ ГРАФИКИ' : 'НАСТРОЙКИ ИНТЕРФЕЙСА', 12 * sx, 12 * sy);
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#577';
  ctx.fillText(
    fitTextStable(ctx, `${controlHint('uiSettings')} открыть/закрыть  |  ${controlHint('gameMenu')} принять/переключить  |  ${menuCloseHint()} закрыть`, w - 24 * sx),
    12 * sx,
    26 * sy,
  );

  const x = 10 * sx;
  const groupW = Math.min(96 * sx, w * 0.28);
  const stateW = Math.min(80 * sx, w * 0.24);
  const labelW = Math.max(48 * sx, w - x * 2 - groupW - stateW - 12 * sx);

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#345';
  ctx.fillText('РАЗДЕЛ', x + 14 * sx, top - 7 * sy);
  ctx.fillText(view === 'graphics' ? 'НАСТРОЙКА' : 'ПРЕСЕТ / ЭЛЕМЕНТ', x + groupW + 18 * sx, top - 7 * sy);
  ctx.fillText(view === 'graphics' ? 'ЗНАЧЕНИЕ' : 'СТАТУС', x + groupW + labelW + 20 * sx, top - 7 * sy);

  ctx.textBaseline = 'middle';
  for (let row = 0; row < visible; row++) {
    const i = scroll + row;
    const item = uiSettingsRowAt(i, view);
    if (!item) break;
    const rowY = top + row * rowH;
    const textY = rowY + rowH * 0.5;
    const isSel = i === selected;
    const isPreset = item.kind === 'preset';
    const isReset = item.kind === 'reset_interface' || item.kind === 'reset_graphics';
    const enabled = item.kind === 'element'
      ? uiElementEnabled(item.element.id)
      : isPreset
        ? activePreset === item.preset.id
        : item.kind === 'auto_pickup'
          ? autoPickupEnabled()
          : false;

    if (isSel) {
      ctx.fillStyle = `rgba(0,90,78,${0.46 + 0.12 * flicker(time, 1245 + i)})`;
      ctx.fillRect(x - 2 * sx, rowY, w - x * 2 + 4 * sx, rowH);
      ctx.strokeStyle = isReset || isPreset || item.kind === 'mobile_sensitivity' || item.kind === 'camera_fov' || item.kind === 'visual_geometry' || item.kind === 'lighting_quality' || (item.kind === 'element' && item.element.locked) ? '#fd6' : 'rgba(0,255,190,0.46)';
      ctx.strokeRect(x - 2 * sx + 0.5, rowY + 0.5, w - x * 2 + 4 * sx - 1, rowH - 1);
    }

    ctx.fillStyle = isSel ? '#0fa' : '#6a8';
    ctx.fillText(isSel ? '▶' : ' ', x, textY);
    if (isReset) {
      ctx.fillStyle = '#b98';
      ctx.fillText(item.group, x + 14 * sx, textY);
      ctx.fillStyle = isSel ? '#ffe7ad' : '#d7c38a';
      ctx.fillText(fitTextStable(ctx, item.label, labelW - 8 * sx), x + groupW + 18 * sx, textY);
      ctx.fillStyle = '#fd6';
      ctx.fillText('ENTER', x + groupW + labelW + 20 * sx, textY);
    } else if (isPreset) {
      ctx.fillStyle = '#b98';
      ctx.fillText('ПРЕСЕТ', x + 14 * sx, textY);
      ctx.fillStyle = isSel ? '#ffe7ad' : '#d7c38a';
      ctx.fillText(fitTextStable(ctx, `${item.preset.label}: ${item.preset.hint}`, labelW - 8 * sx), x + groupW + 18 * sx, textY);
      ctx.fillStyle = enabled ? '#fd6' : '#789';
      ctx.fillText(enabled ? 'ВЫБРАН' : 'ПРИМ', x + groupW + labelW + 20 * sx, textY);
    } else if (item.kind === 'element') {
      const element = item.element;
      ctx.fillStyle = '#689';
      ctx.fillText(fitTextStable(ctx, element.group, groupW - 10 * sx), x + 14 * sx, textY);
      ctx.fillStyle = isSel ? '#dff' : '#9bb';
      ctx.fillText(fitTextStable(ctx, element.label, labelW - 8 * sx), x + groupW + 18 * sx, textY);
      ctx.fillStyle = element.locked ? '#fd6' : enabled ? '#8f8' : '#b66';
      ctx.fillText(element.locked ? 'ВСЕГДА' : enabled ? 'ВКЛ' : 'ВЫКЛ', x + groupW + labelW + 20 * sx, textY);
    } else if (item.kind === 'auto_pickup') {
      ctx.fillStyle = '#689';
      ctx.fillText(fitTextStable(ctx, item.group, groupW - 10 * sx), x + 14 * sx, textY);
      ctx.fillStyle = isSel ? '#dff' : '#9bb';
      ctx.fillText(fitTextStable(ctx, item.label, labelW - 8 * sx), x + groupW + 18 * sx, textY);
      ctx.fillStyle = enabled ? '#8f8' : '#fc8';
      ctx.fillText(enabled ? 'ВКЛ' : 'ВЫКЛ', x + groupW + labelW + 20 * sx, textY);
    } else {
      ctx.fillStyle = '#689';
      ctx.fillText(fitTextStable(ctx, item.group, groupW - 10 * sx), x + 14 * sx, textY);
      ctx.fillStyle = isSel ? '#dff' : '#9bb';
      ctx.fillText(fitTextStable(ctx, item.label, labelW - 8 * sx), x + groupW + 18 * sx, textY);
      ctx.fillStyle = '#fd6';
      ctx.fillText(
        view === 'graphics' ? graphicsValue(item.kind) : `${Math.round(mobileLookSensitivity() * 100)}%`,
        x + groupW + labelW + 20 * sx,
        textY,
      );
    }
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

  ctx.fillStyle = '#456';
  ctx.font = `${7 * sy}px monospace`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    fitTextStable(ctx, view === 'graphics'
      ? 'ENTER меняет строку; графический сброс не трогает UI-пресет. Контраст карты дублирует легенду.'
      : 'Новичок используется по умолчанию. ENTER переключает UI, автоподбор и мобильный обзор; верхняя строка сбрасывает.',
    w - 24 * sx),
    12 * sx,
    h - 10 * sy,
  );
  ctx.textBaseline = prevTextBaseline;
}
