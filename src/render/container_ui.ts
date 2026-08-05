/* ── Container interaction menu ──────────────────────────────── */

import { type Entity, type GameState } from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { containerAccessInfo, containerItemActionInfo, containerTheftStatus } from '../systems/containers';
import { controlBindingLabel, menuCloseHint } from '../systems/controls';
import {
  itemValueDisplay,
  questItemStateColor,
  questItemStateLabel,
} from './economy_ui';
import { containerMenuGridLayout } from './ui_layout';
import { drawCenteredWrappedText, fitText } from './ui_text';
import { drawItemGridIcon } from './item_sprites';

export function drawContainerMenu(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  state: GameState,
  world: World,
  sx: number,
  sy: number,
): void {
  const container = world.containerById.get(state.containerMenuTarget);
  if (!container) return;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const layout = containerMenuGridLayout(cw, ch);
  sx = layout.scale;
  sy = layout.scale;
  ctx.fillStyle = 'rgba(0,0,0,0.98)';
  ctx.fillRect(0, 0, cw, ch);

  const gridCols = layout.cols;
  const gridRows = layout.rows;
  const cellSz = layout.cell;
  const gridTotal = layout.gridTotal;
  const totalW = layout.containerX - layout.startX + gridTotal;
  const startX = layout.startX;
  const startY = layout.startY;
  const containerX = layout.containerX;
  const playerInv = player.inventory ?? [];
  const containerInv = container.inventory;
  const access = containerAccessInfo(container, player, state);

  ctx.fillStyle = '#aaa';
  ctx.font = `${8.2 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('КОНТЕЙНЕР', cw / 2, 10 * sy);
  ctx.textAlign = 'left';

  ctx.font = `${7.2 * sy}px monospace`;
  ctx.fillStyle = '#ee4';
  ctx.fillText(`Вы: ${playerInv.length}/${MAX_INVENTORY_SLOTS}`, startX, startY - 9 * sy);
  const columnW = gridTotal;
  const containerName = fitText(ctx, container.name, columnW * 0.85);
  ctx.fillStyle = access.color;
  ctx.fillText(`${containerName}: ${containerInv.length}`, containerX, startY - 9 * sy);
  ctx.fillStyle = access.color;
  ctx.font = `${6.4 * sy}px monospace`;
  ctx.fillText(fitText(ctx, access.label, columnW), containerX, startY - 18 * sy);
  ctx.fillStyle = '#888';
  let infoY = startY + gridRows * cellSz + 34 * sy;
  ctx.fillText(fitText(ctx, access.detail, totalW), startX, infoY);
  const theftStatus = containerTheftStatus(container);
  if (theftStatus) {
    infoY += 9 * sy;
    ctx.fillStyle = theftStatus.color;
    ctx.fillText(fitText(ctx, `${theftStatus.label}: ${theftStatus.detail}`, totalW), startX, infoY);
  }
  if (container.tags.includes('production_output')) {
    const produced = container.lastProducedItemId ? ITEMS[container.lastProducedItemId]?.name ?? container.lastProducedItemId : '';
    const reason = container.productionBlockedReason === 'no_inputs'
      ? 'нет сырья'
      : container.productionBlockedReason === 'container_full'
        ? 'ящик полон'
        : 'нет ящика';
    const status = container.productionBlockedReason
      ? `Цех стоит: ${reason}`
      : produced
        ? `Цех: ${produced} x${container.lastProducedCount ?? 1}`
        : `Цех: ${container.factoryId ?? 'ожидает сырьё'}`;
    ctx.fillStyle = container.productionBlockedReason ? '#fa4' : '#8cf';
    ctx.fillText(fitText(ctx, status, totalW), startX, infoY + 9 * sy);
  }

  const drawGrid = (inv: { defId: string; count: number }[], gx: number, side: 'player' | 'container') => {
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const idx = row * gridCols + col;
        const cx = gx + col * cellSz;
        const cy = startY + row * cellSz;
        const selected = state.containerSide === side && state.containerCursorX === col && state.containerCursorY === row;

        ctx.fillStyle = selected ? 'rgba(80,120,110,0.55)' : 'rgba(30,30,30,0.82)';
        ctx.fillRect(cx, cy, cellSz - 2, cellSz - 2);
        ctx.strokeStyle = selected ? '#0fa' : '#444';
        ctx.strokeRect(cx, cy, cellSz - 2, cellSz - 2);

        if (idx < inv.length) {
          const item = inv[idx];
          const def = ITEMS[item.defId];
          const value = itemValueDisplay(state, item.defId);
          const questLabel = questItemStateLabel(value.questState);
          const stolenHere = container.stolenItemIds?.includes(item.defId) === true;
          const ownerLabel = side === 'container'
            ? access.theft ? 'ЧУЖ' : access.canTake ? access.label.slice(0, 3) : 'ЗАМ'
            : stolenHere ? 'КРАД' : 'ВАШ';
          ctx.fillStyle = value.scarcityColor;
          ctx.fillRect(cx + 1 * sx, cy + 1 * sy, Math.max(1, 2 * sx), cellSz - 4 * sy);
          ctx.font = `${4.5 * sy}px monospace`;
          ctx.fillStyle = side === 'player' && stolenHere ? '#f84' : side === 'container' ? access.color : '#ee4';
          ctx.fillText(ownerLabel, cx + 4 * sx, cy + 3 * sy);
          if (questLabel) {
            ctx.fillStyle = questItemStateColor(value.questState);
            ctx.textAlign = 'right';
            ctx.fillText(questLabel, cx + cellSz - 4 * sx, cy + 3 * sy);
            ctx.textAlign = 'left';
          }
          drawItemGridIcon(ctx, item.defId, def?.name ?? item.defId, cx, cy, cellSz, sx, sy, selected, selected ? 1 : 0.84, {
            nameYUnits: 8,
            iconTopUnits: 8.8,
            bottomReserveUnits: 5.4,
          });
          ctx.fillStyle = value.scarcityColor;
          ctx.font = `${4.8 * sy}px monospace`;
          ctx.fillText(
            fitText(ctx, value.priceText, item.count > 1 ? cellSz - 18 * sx : cellSz - 6 * sx),
            cx + 4 * sx,
            cy + cellSz - 5 * sy,
          );
          if (item.count > 1) {
            ctx.fillStyle = '#8a8';
            ctx.font = `${4.8 * sy}px monospace`;
            ctx.fillText(`x${item.count}`, cx + cellSz - 16 * sx, cy + cellSz - 5 * sy);
          }
        }
      }
    }
  };

  drawGrid(playerInv, startX, 'player');
  drawGrid(containerInv, containerX, 'container');

  const descY = startY + gridRows * cellSz + 8 * sy;
  const curIdx = state.containerCursorY * gridCols + state.containerCursorX;
  const curInv = state.containerSide === 'player' ? playerInv : containerInv;
  ctx.textAlign = 'center';
  if (curIdx < curInv.length) {
    const item = curInv[curIdx];
    const def = ITEMS[item.defId];
    ctx.fillStyle = '#ccc';
    ctx.font = `${7.3 * sy}px monospace`;
    const descW = Math.min(cw - 16 * sx, totalW + 24 * sx);
    ctx.fillText(fitText(ctx, `${def?.name ?? item.defId} x${item.count}`, descW), cw / 2, descY);
    ctx.fillStyle = '#888';
    ctx.font = `${6.4 * sy}px monospace`;
    let actionY = drawCenteredWrappedText(ctx, def?.desc ?? '', cw / 2, descY + 9 * sy, descW, 8 * sy, 2);
    const side = state.containerSide === 'player' ? 'player' : 'container';
    const actionInfo = containerItemActionInfo(container, player, side, item, state);
    const actionDetail = actionInfo.detail && (actionInfo.mode === 'steal' || actionInfo.mode === 'buy' || actionInfo.mode === 'unlock' || actionInfo.mode === 'service')
      ? actionInfo.detail
      : '';
    ctx.fillStyle = actionInfo.enabled ? actionInfo.color : '#f84';
    actionY = Math.min(actionY + 3 * sy, ch - 52 * sy);
    const value = itemValueDisplay(state, item.defId);
    ctx.fillStyle = value.scarcityColor;
    ctx.fillText(fitText(ctx, value.line, descW), cw / 2, actionY);
    ctx.fillStyle = '#888';
    ctx.fillText(fitText(ctx, actionDetail || value.detail, descW), cw / 2, actionY + 8 * sy);
    ctx.fillStyle = actionInfo.enabled ? actionInfo.color : '#f84';
    if (value.questState) {
      const questLabel = value.questState === 'target' ? 'Квестовая цель' : 'Квестовая награда';
      ctx.fillStyle = questItemStateColor(value.questState);
      ctx.fillText(fitText(ctx, questLabel, descW), cw / 2, actionY + 16 * sy);
      ctx.fillStyle = actionInfo.enabled ? actionInfo.color : '#f84';
      ctx.fillText(fitText(ctx, actionInfo.label, descW), cw / 2, Math.min(actionY + 24 * sy, ch - 34 * sy));
    } else {
      ctx.fillText(fitText(ctx, actionInfo.label, descW), cw / 2, Math.min(actionY + 16 * sy, ch - 34 * sy));
    }
  } else {
    ctx.fillStyle = '#555';
    ctx.font = `${6.4 * sy}px monospace`;
    ctx.fillText('Пустой слот', cw / 2, descY + 6 * sy);
  }
  ctx.textAlign = 'left';

  ctx.fillStyle = '#555';
  ctx.font = `${5.8 * sy}px monospace`;
  ctx.textAlign = 'right';
  const hintW = Math.max(60 * sx, cw - 16 * sx);
  ctx.fillText(fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} - курсор`, hintW), cw - 8 * sx, ch - 24 * sy);
  ctx.fillText(fitText(ctx, `${controlBindingLabel('gameMenu')} - действие с предметом`, hintW), cw - 8 * sx, ch - 16 * sy);
  ctx.fillText(fitText(ctx, `${menuCloseHint()} - закрыть`, hintW), cw - 8 * sx, ch - 8 * sy);
  ctx.textAlign = 'left';
}
