/* ── NPC interaction menu ─────────────────────────────────────── */

import { type Entity, type GameState, Faction } from '../core/types';
import { ITEMS } from '../data/catalog';
import { FACTION_NAMES, OCCUPATION_NAMES } from '../data/relations';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { getDiceSnapshot } from '../systems/dice';
import { getDominoSnapshot } from '../systems/domino';
import { getCheckersSnapshot } from '../systems/checkers';
import { getDurakSnapshot } from '../systems/durak';
import {
  getNpcInteractionInterfaceSnapshot,
  getNpcMenuOptions,
  NPC_MENU_INTERFACE_TAB,
} from '../systems/npc_interaction_options';
import { questDeadlineText, questRemainingMinutes } from '../systems/quest_deadlines';
import { drawNeuroPanel, drawGlitchText, textJitter, flicker } from './hud_fx';
import { dialogMenuScale, tradeMenuGridLayout } from './ui_layout';
import { drawCenteredWrappedText, drawWrappedText, fitText } from './ui_text';
import { drawDurakInterface } from './durak_ui';
import { drawDiceInterface } from './dice_ui';
import { drawDominoInterface } from './domino_ui';
import { drawCheckersInterface } from './checkers_ui';
import {
  questItemStateColor,
  questItemStateLabel,
  tradeCellPriceDisplay,
  tradePriceDisplay,
} from './economy_ui';
import {
  getTradeDealSummary,
  getTradeNpcOffer,
  getTradeOffer,
} from '../systems/trade';
import { drawItemGridIcon } from './item_sprites';

export function drawNpcMenu(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  state: GameState,
  entities: Entity[],
  sx: number, sy: number,
  uiTime = state.time,
): void {
  const npc = entities.find(e => e.id === state.npcMenuTarget);
  if (!npc) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const ds = dialogMenuScale(w, h, sx, sy);
  sx = ds;
  sy = ds;
  const pw = Math.min(440 * sx, w - 24 * sx);
  const ph = Math.min(320 * sy, h - 24 * sy);
  const px = (w - pw) / 2;
  const py = (h - ph) / 2;
  const time = uiTime;

  // Background — neuro-panel
  ctx.fillStyle = '#00040a';
  ctx.fillRect(px, py, pw, ph);
  drawNeuroPanel(ctx, px, py, pw, ph, time, 90);

  // NPC name header
  const fName = npc.faction !== undefined ? FACTION_NAMES[npc.faction as Faction] : '';
  const oName = npc.occupation !== undefined ? OCCUPATION_NAMES[npc.occupation] : '';
  ctx.font = `${9 * sy}px monospace`;
  drawGlitchText(ctx, fitText(ctx, npc.name ?? '???', pw - 16 * sx), px + 8 * sx, py + 10 * sy, time, 900, '#0fa', 9 * sy);
  ctx.fillStyle = '#688';
  ctx.font = `${6.2 * sy}px monospace`;
  const fj = textJitter(time, 901);
  ctx.fillText(fitText(ctx, `${fName} · ${oName}`, pw - 16 * sx), px + 8 * sx + fj.dx, py + 22 * sy + fj.dy);

  if (state.npcMenuTab === 'main') {
    const items = getNpcMenuOptions({ state, player, npc, entities });
    ctx.font = `${8.6 * sy}px monospace`;
    for (let i = 0; i < items.length; i++) {
      const selected = i === state.npcMenuSel;
      const yy = py + 42 * sy + i * 17 * sy;
      const mj = textJitter(time, 910 + i);
      ctx.fillStyle = items[i].disabled
        ? selected ? '#9a6' : '#665'
        : selected ? `rgba(0,255,170,${flicker(time, 920 + i)})` : '#688';
      ctx.fillText(`${selected ? '▶ ' : '  '}${items[i].label}`, px + 16 * sx + mj.dx, yy + mj.dy);
    }
    ctx.fillStyle = '#456';
    ctx.font = `${6.8 * sy}px monospace`;
    ctx.fillText(fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} выбор  |  ${controlHint('gameMenu')} выбрать  |  ${menuCloseHint()} закрыть`, pw - 16 * sx), px + 8 * sx, py + ph - 11 * sy);

  } else if (state.npcMenuTab === 'talk') {
    // Talk: show procedural text
    ctx.fillStyle = '#ccc';
    ctx.font = `${7.8 * sy}px monospace`;
    const maxW = pw - 16 * sx;
    const maxLines = Math.max(1, Math.floor((py + ph - 26 * sy - (py + 40 * sy)) / (11 * sy)));
    drawWrappedText(ctx, state.npcTalkText, px + 8 * sx, py + 40 * sy, maxW, 11 * sy, maxLines);

    ctx.fillStyle = '#555';
    ctx.font = `${6.8 * sy}px monospace`;
    ctx.fillText(`${controlHint('gameMenu')} назад  |  ${menuCloseHint()} закрыть`, px + 8 * sx, py + ph - 11 * sy);

  } else if (state.npcMenuTab === 'quest') {
    // Quest tab: paginated, one quest per page with word wrap
    const active = state.quests.filter(q => !q.done);
    const total = active.length;
    ctx.font = `${7.8 * sy}px monospace`;
    if (total === 0) {
      ctx.fillStyle = '#888';
      ctx.fillText('Активных заданий нет.', px + 8 * sx, py + 40 * sy);
    } else {
      const page = Math.min(state.questPage, total - 1);
      const q = active[page];
      // Header: page indicator
      ctx.fillStyle = '#888';
      ctx.font = `${6.8 * sy}px monospace`;
      ctx.fillText(`${page + 1} / ${total}`, px + pw - 40 * sx, py + 10 * sy);
      // Quest giver
      ctx.fillStyle = '#8af';
      ctx.font = `${7.8 * sy}px monospace`;
      ctx.fillText(fitText(ctx, `От: ${q.giverName ?? '???'}`, pw - 16 * sx), px + 8 * sx, py + 38 * sy);
      // Quest description — word-wrapped
      ctx.fillStyle = '#dda';
      const maxW = pw - 16 * sx;
      let ly = py + 54 * sy;
      const maxLines = Math.max(1, Math.floor((py + ph - 42 * sy - ly) / (11 * sy)));
      ly = drawWrappedText(ctx, q.desc, px + 8 * sx, ly, maxW, 11 * sy, maxLines);
      // Progress for KILL quests
      if (q.killNeeded !== undefined) {
        ly += 4 * sy;
        ctx.fillStyle = '#aaa';
        ctx.fillText(`Прогресс: ${q.killCount ?? 0}/${q.killNeeded}`, px + 8 * sx, ly);
      }
      const remaining = questRemainingMinutes(q, state.clock.totalMinutes);
      if (remaining !== undefined) {
        ly += 12 * sy;
        ctx.fillStyle = remaining <= 120 ? '#f66' : remaining <= 360 ? '#fa6' : '#8cf';
        ctx.font = `${6.8 * sy}px monospace`;
        ctx.fillText(fitText(ctx, `Срок: ${questDeadlineText(q, state.clock.totalMinutes)}`, maxW), px + 8 * sx, ly);
      }
    }
    ctx.fillStyle = '#555';
    ctx.font = `${6.8 * sy}px monospace`;
    const hint = total > 1
      ? `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} листать  |  ${controlHint('gameMenu')} назад  |  ${menuCloseHint()} закрыть`
      : `${controlHint('gameMenu')} назад  |  ${menuCloseHint()} закрыть`;
    ctx.fillText(fitText(ctx, hint, pw - 16 * sx), px + 8 * sx, py + ph - 11 * sy);

  } else if (state.npcMenuTab === NPC_MENU_INTERFACE_TAB) {
    const durak = getDurakSnapshot();
    if (durak.open && durak.npcId === npc.id) {
      drawDurakInterface(ctx, durak, px, py, pw, ph, sx, sy, time);
      return;
    }
    const dice = getDiceSnapshot();
    if (dice.open && dice.npcId === npc.id) {
      drawDiceInterface(ctx, dice, px, py, pw, ph, sx, sy, time);
      return;
    }
    const domino = getDominoSnapshot();
    if (domino.open && domino.npcId === npc.id) {
      drawDominoInterface(ctx, domino, px, py, pw, ph, sx, sy, time);
      return;
    }
    const checkers = getCheckersSnapshot();
    if (checkers.open && checkers.npcId === npc.id) {
      drawCheckersInterface(ctx, checkers, px, py, pw, ph, sx, sy, time);
      return;
    }
    const snapshot = getNpcInteractionInterfaceSnapshot();
    ctx.fillStyle = '#d7f7ff';
    ctx.font = `${9.2 * sy}px monospace`;
    drawGlitchText(ctx, fitText(ctx, snapshot.title || 'ИНТЕРФЕЙС', pw - 16 * sx), px + 8 * sx, py + 38 * sy, time, 940, '#ffd36a', 9.2 * sy);

    ctx.fillStyle = '#888';
    ctx.font = `${6.8 * sy}px monospace`;
    let ly = py + 56 * sy;
    const maxW = pw - 16 * sx;
    ctx.fillText(fitText(ctx, snapshot.npcName || npc.name || 'NPC', maxW), px + 8 * sx, ly);
    ly += 14 * sy;
    if (snapshot.stakeRubles !== undefined) {
      ctx.fillStyle = '#ee4';
      ctx.fillText(fitText(ctx, `Ставка: ₽${snapshot.stakeRubles}`, maxW), px + 8 * sx, ly);
      ly += 12 * sy;
    }
    if (snapshot.priceRubles !== undefined) {
      ctx.fillStyle = '#ee4';
      ctx.fillText(fitText(ctx, `Цена: ₽${snapshot.priceRubles}`, maxW), px + 8 * sx, ly);
      ly += 12 * sy;
    }
    ctx.fillStyle = '#ccc';
    ctx.font = `${7.8 * sy}px monospace`;
    for (const line of snapshot.lines) {
      ly = drawWrappedText(ctx, line, px + 8 * sx, ly, maxW, 10.5 * sy, 2) + 3 * sy;
      if (ly > py + ph - 48 * sy) break;
    }
    if (snapshot.message && ly <= py + ph - 36 * sy) {
      ctx.fillStyle = '#8cf';
      ctx.font = `${6.8 * sy}px monospace`;
      drawWrappedText(ctx, snapshot.message, px + 8 * sx, ly, maxW, 9 * sy, 2);
    }
    ctx.fillStyle = '#555';
    ctx.font = `${6.8 * sy}px monospace`;
    ctx.fillText(`${controlHint('gameMenu')} назад  |  ${menuCloseHint()} закрыть`, px + 8 * sx, py + ph - 11 * sy);

  } else if (state.npcMenuTab === 'trade') {
    // ── Fullscreen trade: symmetric inventories and offer baskets ──
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const layout = tradeMenuGridLayout(cw, ch);
    sx = layout.scale;
    sy = layout.scale;
    // Overdraw fullscreen background
    ctx.fillStyle = 'rgba(0,0,0,0.98)';
    ctx.fillRect(0, 0, cw, ch);
    const gridCols = layout.cols;
    const gridRows = layout.rows;
    const cellSz = layout.cell;
    const gridTotal = layout.gridTotal;
    const totalW = layout.npcX - layout.startX + gridTotal;
    const startX = layout.startX;
    const startY = layout.startY;
    const playerOfferX = layout.playerOfferX;
    const npcOfferX = layout.npcOfferX;
    const npcX = layout.npcX;
    const dealX = layout.dealX;
    const dealY = layout.dealY;
    const dealW = layout.dealW;
    const dealH = layout.dealH;

    const npcInv = npc.inventory ?? [];
    const plrInv = player.inventory ?? [];
    const playerOffer = getTradeOffer(state);
    const npcOffer = getTradeNpcOffer(state);
    const deal = getTradeDealSummary(state, npc);
    const stagedCount = (offer: readonly { defId: string; count: number; data?: unknown }[], item: { defId: string; data?: unknown }): number => {
      let count = 0;
      for (const slot of offer) if (slot.defId === item.defId && slot.data === item.data) count += slot.count;
      return count;
    };

    // ── Title (centered) ──
    ctx.fillStyle = '#aaa';
    ctx.font = `${8.2 * sy}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('ТОРГ', cw / 2, 10 * sy);
    ctx.textAlign = 'left';

    // ── Headers with money ──
    ctx.font = `${7.1 * sy}px monospace`;
    ctx.fillStyle = '#ee4';
    ctx.fillText(`Вы: ₽${player.money ?? 0}`, startX, startY - 8 * sy);
    ctx.fillStyle = '#cc9';
    ctx.fillText(fitText(ctx, `Вы отдаете · ${deal.creditValue}₽`, gridTotal), playerOfferX, startY - 8 * sy);
    ctx.fillStyle = '#9cf';
    ctx.fillText(fitText(ctx, `Вы берете · ${deal.fullPrice}₽`, gridTotal), npcOfferX, startY - 8 * sy);
    ctx.fillStyle = '#8cf';
    ctx.fillText(
      fitText(ctx, `${npc.name?.split(' ')[0] ?? 'NPC'}: ₽${npc.money ?? 0}`, gridTotal),
      npcX, startY - 8 * sy,
    );

    // ── Draw grid helper ──
    const drawGrid = (
      inv: readonly { defId: string; count: number; data?: unknown }[],
      gx: number,
      side: 'player' | 'player_offer' | 'npc_offer' | 'npc',
    ) => {
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const idx = row * gridCols + col;
          const cx = gx + col * cellSz;
          const cy = startY + row * cellSz;
          const selected = state.tradeSide === side && state.tradeCursorX === col && state.tradeCursorY === row;

          ctx.fillStyle = selected ? 'rgba(120,120,50,0.5)' : 'rgba(30,30,30,0.8)';
          ctx.fillRect(cx, cy, cellSz - 2, cellSz - 2);
          ctx.strokeStyle = selected ? '#ee4' : '#444';
          ctx.strokeRect(cx, cy, cellSz - 2, cellSz - 2);

          if (idx < inv.length) {
            const item = inv[idx];
            const def = ITEMS[item.defId];
            const priceMode = side === 'npc' || side === 'npc_offer' ? 'buy' : 'sell';
            const price = tradeCellPriceDisplay(state, npc, item.defId, priceMode);
            const questLabel = questItemStateLabel(price.questState);
            const roleLabel = side === 'npc' ? 'ПРОД' : side === 'npc_offer' ? 'БЕР' : side === 'player_offer' ? 'ОТД' : 'ВАШ';
            const staged = side === 'player'
              ? stagedCount(playerOffer, item)
              : side === 'npc'
                ? stagedCount(npcOffer, item)
                : 0;
            ctx.fillStyle = price.scarcityColor;
            ctx.fillRect(cx + 1 * sx, cy + 1 * sy, Math.max(1, 2 * sx), cellSz - 4 * sy);
            ctx.save();
            ctx.beginPath();
            ctx.rect(cx + 2 * sx, cy + 2 * sy, Math.max(1, cellSz - 5 * sx), Math.max(1, cellSz - 5 * sy));
            ctx.clip();
            const padX = Math.max(3, 2.5 * sx);
            const innerW = Math.max(1, cellSz - padX * 2);
            const topY = cy + 5.3 * sy;
            ctx.font = `${Math.max(4, 3.5 * sy)}px monospace`;
            ctx.fillStyle = side === 'npc' || side === 'npc_offer' ? '#8cf' : '#ee4';
            const questW = questLabel ? Math.min(cellSz * 0.42, Math.max(12 * sx, ctx.measureText(questLabel).width + 2 * sx)) : 0;
            ctx.fillText(fitText(ctx, roleLabel, Math.max(1, innerW - questW)), cx + padX, topY);
            if (questLabel) {
              ctx.fillStyle = questItemStateColor(price.questState);
              ctx.textAlign = 'right';
              ctx.fillText(fitText(ctx, questLabel, questW), cx + cellSz - padX, topY);
              ctx.textAlign = 'left';
            }
            drawItemGridIcon(ctx, item.defId, def?.name ?? item.defId, cx, cy, cellSz, sx, sy, selected, selected ? 1 : 0.84, {
              nameYUnits: 9.7,
              iconTopUnits: 10.6,
              bottomReserveUnits: 7.6,
            });
            const countText = staged > 0 ? `→${staged}` : item.count > 1 ? `×${item.count}` : '';
            ctx.fillStyle = price.color;
            ctx.font = `${Math.max(4, 4.05 * sy)}px monospace`;
            const countW = countText ? Math.min(cellSz * 0.42, Math.max(11 * sx, ctx.measureText(countText).width + 3 * sx)) : 0;
            const bottomY = cy + cellSz - 3.7 * sy;
            ctx.fillText(fitText(ctx, price.text, Math.max(1, innerW - countW)), cx + padX, bottomY);
            if (countText) {
              ctx.textAlign = 'right';
              ctx.fillStyle = staged > 0 ? '#fc4' : '#8a8';
              ctx.fillText(fitText(ctx, countText, countW), cx + cellSz - padX, bottomY);
              ctx.textAlign = 'left';
            }
            ctx.restore();
          }
        }
      }
    };

    drawGrid(plrInv, startX, 'player');
    drawGrid(playerOffer, playerOfferX, 'player_offer');
    drawGrid(npcOffer, npcOfferX, 'npc_offer');
    drawGrid(npcInv, npcX, 'npc');

    const canDeal = ((deal.npcOfferCount ?? 0) > 0 || deal.creditCount > 0) && (player.money ?? 0) >= deal.cashDue;
    const dealSelected = state.tradeSide === 'deal';
    ctx.fillStyle = dealSelected ? (canDeal ? 'rgba(40,110,55,0.9)' : 'rgba(120,65,25,0.9)') : 'rgba(20,28,24,0.94)';
    ctx.fillRect(dealX, dealY, dealW, dealH);
    ctx.strokeStyle = dealSelected ? (canDeal ? '#8f8' : '#f84') : '#466';
    ctx.strokeRect(dealX, dealY, dealW, dealH);
    ctx.textAlign = 'center';
    ctx.font = `${6.4 * sy}px monospace`;
    ctx.fillStyle = canDeal ? '#8f8' : '#f84';
    const dealText = canDeal
      ? deal.cashDue > 0
        ? `ОБМЕН · доплата ${deal.cashDue}₽`
        : deal.changeDue > 0
          ? `ОБМЕН · сдача ${deal.changeDue}₽`
          : (deal.npcOfferCount ?? 0) <= 0
            ? 'ОТДАТЬ NPC'
            : 'ОБМЕН'
      : ((deal.npcOfferCount ?? 0) <= 0 && deal.creditCount <= 0)
        ? 'ОБМЕН · выберите предметы'
        : `НЕ ХВАТАЕТ ${deal.cashDue - (player.money ?? 0)}₽`;
    ctx.fillText(fitText(ctx, dealText, dealW - 8 * sx), dealX + dealW / 2, dealY + dealH * 0.62);
    const unpaidSurplus = Math.max(0, deal.surplus - deal.changeDue);
    ctx.fillStyle = deal.changeDue > 0 ? '#8f8' : unpaidSurplus > 0 ? '#fa6' : '#889';
    ctx.font = `${5.6 * sy}px monospace`;
    const summaryLine = deal.changeDue > 0
      ? `NPC ${deal.fullPrice}₽ · вы ${deal.creditValue}₽ · сдача ${deal.changeDue}₽${unpaidSurplus > 0 ? ` · без сдачи ${unpaidSurplus}₽` : ''}`
      : unpaidSurplus > 0
        ? `NPC ${deal.fullPrice}₽ · вы ${deal.creditValue}₽ · сдачи нет (${unpaidSurplus}₽)`
      : `NPC ${deal.fullPrice}₽ · вы ${deal.creditValue}₽ · наличными ${deal.cashDue}₽`;
    ctx.fillText(fitText(ctx, summaryLine, dealW - 8 * sx), dealX + dealW / 2, dealY + dealH + 7.2 * sy);
    ctx.textAlign = 'left';

    // ── Selected item description ──
    const descY = dealY + dealH + 18 * sy;
    const curIdx = state.tradeCursorY * gridCols + state.tradeCursorX;
    const curInv = state.tradeSide === 'player'
      ? plrInv
      : state.tradeSide === 'player_offer'
        ? playerOffer
        : state.tradeSide === 'npc_offer'
          ? npcOffer
          : state.tradeSide === 'npc'
            ? npcInv
            : [];
    ctx.textAlign = 'center';
    if (curIdx < curInv.length) {
      const item = curInv[curIdx];
      const def = ITEMS[item.defId];
      if (def) {
        ctx.fillStyle = '#ccc';
        ctx.font = `${7.2 * sy}px monospace`;
        const descW = Math.min(cw - 16 * sx, totalW + 24 * sx);
        ctx.fillText(fitText(ctx, `${def.name} ×${item.count}`, descW), cw / 2, descY);
        ctx.fillStyle = '#888';
        ctx.font = `${6.3 * sy}px monospace`;
        let actionY = drawCenteredWrappedText(ctx, def.desc, cw / 2, descY + 9 * sy, descW, 8 * sy, 2);
        const priceMode = state.tradeSide === 'npc' || state.tradeSide === 'npc_offer' ? 'buy' : 'sell';
        const price = tradePriceDisplay(state, player, npc, item.defId, priceMode);
        ctx.fillStyle = price.color;
        actionY = Math.min(actionY + 2 * sy, ch - 50 * sy);
        if (state.tradeSide === 'npc') {
          ctx.fillText(fitText(ctx, `${controlBindingLabel('gameMenu')} запросить: ${price.line}`, descW), cw / 2, actionY);
          ctx.fillStyle = price.scarcityColor;
          ctx.fillText(fitText(ctx, price.detail, descW), cw / 2, actionY + 8 * sy);
        } else if (state.tradeSide === 'player_offer') {
          ctx.fillText(fitText(ctx, `${controlBindingLabel('gameMenu')} убрать единицу из того, что отдаете`, descW), cw / 2, actionY);
        } else if (state.tradeSide === 'npc_offer') {
          ctx.fillText(fitText(ctx, `${controlBindingLabel('gameMenu')} убрать единицу из того, что берете`, descW), cw / 2, actionY);
        } else {
          ctx.fillText(fitText(ctx, `${controlBindingLabel('gameMenu')} предложить: ${price.line}`, descW), cw / 2, actionY);
          ctx.fillStyle = price.scarcityColor;
          ctx.fillText(fitText(ctx, price.detail, descW), cw / 2, actionY + 8 * sy);
        }
      }
    } else if (state.tradeSide === 'deal') {
      ctx.fillStyle = canDeal ? '#8f8' : '#f84';
      ctx.font = `${7 * sy}px monospace`;
      ctx.fillText(fitText(ctx, canDeal ? `${controlBindingLabel('gameMenu')} подтвердить сделку` : 'Сделка пока невозможна', Math.min(cw - 16 * sx, totalW)), cw / 2, descY + 6 * sy);
    } else {
      ctx.fillStyle = '#555';
      ctx.font = `${6.2 * sy}px monospace`;
      ctx.fillText('Пусто', cw / 2, descY + 6 * sy);
    }
    ctx.textAlign = 'left';

    // ── Hint (bottom-right, stacked) ──
    ctx.fillStyle = '#555';
    ctx.font = `${5.8 * sy}px monospace`;
    ctx.textAlign = 'right';
    const hintW = Math.max(60 * sx, cw - 16 * sx);
    ctx.fillText(fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} курсор`, hintW), cw - 8 * sx, ch - 24 * sy);
    ctx.fillText(fitText(ctx, `${controlBindingLabel('gameMenu')} положить/убрать/обмен`, hintW), cw - 8 * sx, ch - 16 * sy);
    ctx.fillText(fitText(ctx, `${menuCloseHint()} назад`, hintW), cw - 8 * sx, ch - 8 * sy);
    ctx.textAlign = 'left';

  }
}
