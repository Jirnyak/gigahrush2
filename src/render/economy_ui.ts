import { type Entity, type GameState } from '../core/types';
import { ITEMS } from '../data/catalog';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { getStack } from '../data/items';
import { RESOURCES, RESOURCE_BY_ID } from '../data/resources';
import { bankingSummary } from '../systems/banking';
import { controlHint } from '../systems/controls';
import { getAdjustedItemPrice, getEconomyQuote, getItemPriceMultiplier, getResourceScarcity } from '../systems/economy';
import { stockMarketSnapshot } from '../systems/stock_market';
import { drawGlitchText, drawNeuroPanel } from './hud_fx';
import { fitText } from './ui_text';

type LooseRecord = Record<string, unknown>;

export interface FinanceSnapshot {
  cash: number;
  hasBanking: boolean;
  accountRubles: number;
  depositPrincipal: number;
  depositYield: number;
  debtRubles: number;
  creditLimit: number;
  hasStock: boolean;
  portfolioValue: number;
  portfolioPL: number;
}

export interface FinanceLine {
  text: string;
  color: string;
}

export interface TradePriceDisplay {
  price: number;
  line: string;
  detail: string;
  scarcity: string;
  scarcityColor: string;
  status: string;
  color: string;
  ok: boolean;
}

export type QuestItemState = '' | 'target' | 'reward';

export interface ScarcityBand {
  label: string;
  short: string;
  color: string;
}

export interface TradeCellPriceDisplay {
  text: string;
  color: string;
  scarcityColor: string;
  scarcityLabel: string;
  questState: QuestItemState;
}

export interface ItemValueDisplay {
  priceText: string;
  line: string;
  detail: string;
  scarcityColor: string;
  questState: QuestItemState;
}

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' ? value as LooseRecord : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function compactRubles(value: number): string {
  const rounded = Math.round(value);
  return `${rounded}₽`;
}

function formatMult(value: number): string {
  return `x${value.toFixed(1)}`;
}

function shortResourceName(resourceId: string | undefined): string {
  if (!resourceId) return '';
  const name = RESOURCE_BY_ID[resourceId]?.name ?? resourceId;
  return name
    .replace('Питьевая вода', 'Вода')
    .replace('Промышленная масса', 'Проммасса')
    .replace('Грибной субстрат', 'Грибсырьё');
}

export function scarcityBand(multiplier: number): ScarcityBand {
  const m = Number.isFinite(multiplier) ? multiplier : 1;
  if (m >= 2.05) return { label: 'КРИЗИС', short: 'КРЗ', color: '#f55' };
  if (m >= 1.35) return { label: 'ДЕФИЦИТ', short: 'ДФЦ', color: '#fa4' };
  if (m >= 1.12) return { label: 'НАПРЯЖ.', short: 'НАП', color: '#dda64a' };
  if (m <= 0.72) return { label: 'ИЗБЫТОК', short: 'ИЗБ', color: '#6cf' };
  if (m <= 0.88) return { label: 'ЗАПАС', short: 'ЗАП', color: '#8cf' };
  return { label: 'НОРМА', short: 'НОР', color: '#8a8' };
}

export function questItemState(state: GameState, defId: string): QuestItemState {
  let reward = false;
  for (const q of state.quests) {
    if (q.done || q.failed) continue;
    if (q.targetItem === defId) return 'target';
    if (q.rewardItem === defId) reward = true;
    if (q.extraRewards?.some(r => r.defId === defId)) reward = true;
  }
  return reward ? 'reward' : '';
}

export function questItemStateLabel(state: QuestItemState): string {
  if (state === 'target') return 'ЦЕЛЬ';
  if (state === 'reward') return 'НАГР';
  return '';
}

export function questItemStateColor(state: QuestItemState): string {
  if (state === 'target') return '#6cf';
  if (state === 'reward') return '#8f8';
  return '#888';
}

function formatSignedRubles(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : ''}${rounded}₽`;
}

function economyPressureLine(state: GameState): FinanceLine | null {
  let scarceId = '';
  let scarceMult = 1;
  let surplusId = '';
  let surplusMult = 1;
  for (const res of RESOURCES) {
    const mult = getResourceScarcity(state, res.id);
    if (mult > scarceMult) {
      scarceMult = mult;
      scarceId = res.id;
    }
    if (mult < surplusMult) {
      surplusMult = mult;
      surplusId = res.id;
    }
  }
  if (scarceMult >= 1.18) {
    const band = scarcityBand(scarceMult);
    return {
      text: `${band.label.toLowerCase()}: ${shortResourceName(scarceId)} ${formatMult(scarceMult)}`,
      color: band.color,
    };
  }
  if (surplusMult <= 0.82) {
    const band = scarcityBand(surplusMult);
    return {
      text: `${band.label.toLowerCase()}: ${shortResourceName(surplusId)} ${formatMult(surplusMult)}`,
      color: band.color,
    };
  }
  return null;
}

function readBanking(state: GameState): Pick<
  FinanceSnapshot,
  'hasBanking' | 'accountRubles' | 'depositPrincipal' | 'depositYield' | 'debtRubles' | 'creditLimit'
> {
  const banking = asRecord((state as GameState & { banking?: unknown }).banking);
  if (!banking) {
    return {
      hasBanking: false,
      accountRubles: 0,
      depositPrincipal: 0,
      depositYield: 0,
      debtRubles: 0,
      creditLimit: 0,
    };
  }

  const summary = bankingSummary(state);
  const elapsedMinutes = Math.max(0, num(state.clock?.totalMinutes) - summary.lastInterestAt);
  const pendingDepositYield = summary.depositPrincipal > 0 && summary.depositRate > 0
    ? summary.depositPrincipal * summary.depositRate * Math.min(1, elapsedMinutes / 60)
    : 0;

  const depositPrincipal = Math.max(0, num(banking.depositPrincipal));
  const depositAccrued = Math.max(0, num(banking.depositAccrued ?? banking.depositInterest));
  const depositRate = Math.max(0, num(banking.depositRate));
  const depositOpenedAt = num(banking.depositOpenedAt, state.time);
  const elapsedDays = Math.max(0, Math.min(3650, (state.time - depositOpenedAt) / 86400));
  const estimatedYield = depositAccrued || depositPrincipal * depositRate * elapsedDays / 365;
  const loanPrincipal = Math.max(0, num(banking.loanPrincipal ?? banking.debtPrincipal));
  const loanAccrued = Math.max(0, num(banking.loanAccrued ?? banking.debtAccrued));

  return {
    hasBanking: true,
    accountRubles: summary.accountRubles,
    depositPrincipal: summary.depositPrincipal || depositPrincipal,
    depositYield: Math.max(0, pendingDepositYield || estimatedYield),
    debtRubles: summary.debtRubles || Math.max(0, num(banking.debtRubles, loanPrincipal + loanAccrued)),
    creditLimit: summary.creditLimit,
  };
}

function readStock(state: GameState): Pick<FinanceSnapshot, 'hasStock' | 'portfolioValue' | 'portfolioPL'> {
  const stock = asRecord((state as GameState & { stockMarket?: unknown }).stockMarket);
  if (!stock) return { hasStock: false, portfolioValue: 0, portfolioPL: 0 };

  const directValue = num(stock.portfolioValue ?? stock.portfolioRubles, Number.NaN);
  const directPL = num(stock.portfolioPL ?? stock.unrealizedPL, Number.NaN);
  const quotes = asRecord(stock.quotes);
  const portfolio = asRecord(stock.portfolio);
  let value = Number.isFinite(directValue) ? directValue : 0;
  let cost = 0;
  let directPositions = 0;

  if (quotes && portfolio) {
    value = 0;
    for (const [corpId, posValue] of Object.entries(portfolio)) {
      const pos = asRecord(posValue);
      const quote = asRecord(quotes[corpId]);
      if (!pos || !quote) continue;
      const shares = Math.max(0, num(pos.shares));
      const avgPrice = Math.max(0, num(pos.avgPrice));
      const price = Math.max(0, num(quote.price));
      value += shares * price;
      cost += shares * avgPrice;
      if (shares > 0) directPositions++;
    }
  }

  const snapshot = stockMarketSnapshot(state);
  const snapshotCost = snapshot.quotes.reduce((sum, quote) => sum + quote.shares * quote.avgPrice, 0);
  const snapshotPL = snapshot.portfolioValue - snapshotCost;
  if (snapshot.quotes.length > 0 && (snapshot.portfolioValue > 0 || directPositions === 0)) {
    return {
      hasStock: true,
      portfolioValue: Math.max(0, snapshot.portfolioValue),
      portfolioPL: snapshotPL,
    };
  }

  return {
    hasStock: true,
    portfolioValue: Math.max(0, value),
    portfolioPL: Number.isFinite(directPL) ? directPL : value - cost,
  };
}

export function readFinanceSnapshot(player: Entity, state: GameState): FinanceSnapshot {
  const banking = readBanking(state);
  const stock = readStock(state);
  return {
    cash: Math.max(0, player.money ?? 0),
    ...banking,
    ...stock,
  };
}

export function financeDetailLines(snapshot: FinanceSnapshot): FinanceLine[] {
  const lines: FinanceLine[] = [
    { text: `Наличные: ${compactRubles(snapshot.cash)}`, color: '#ee4' },
  ];
  if (snapshot.hasBanking) {
    lines.push({ text: `Счет: ${compactRubles(snapshot.accountRubles)}`, color: '#8cf' });
    if (snapshot.depositPrincipal > 0 || snapshot.depositYield > 0) {
      lines.push({
        text: `Депозит: ${compactRubles(snapshot.depositPrincipal)} +~${compactRubles(snapshot.depositYield)}`,
        color: '#8f8',
      });
    }
    if (snapshot.debtRubles > 0 || snapshot.creditLimit > 0) {
      const debt = snapshot.debtRubles > 0 ? `Долг: ${compactRubles(snapshot.debtRubles)}` : 'Долг: 0₽';
      const limit = snapshot.creditLimit > 0 ? ` / лимит ${compactRubles(snapshot.creditLimit)}` : '';
      lines.push({ text: `${debt}${limit}`, color: snapshot.debtRubles > 0 ? '#f86' : '#789' });
    }
  }
  if (snapshot.hasStock) {
    lines.push({ text: `Портфель: ${compactRubles(snapshot.portfolioValue)}`, color: '#9df' });
    lines.push({
      text: `Акции P/L: ${formatSignedRubles(snapshot.portfolioPL)}`,
      color: snapshot.portfolioPL >= 0 ? '#8f8' : '#f86',
    });
  }
  return lines;
}

export function hudFinanceLines(snapshot: FinanceSnapshot, state?: GameState): FinanceLine[] {
  const top = snapshot.hasBanking
    ? `₽${Math.round(snapshot.cash)} сч ${Math.round(snapshot.accountRubles)}`
    : `₽${Math.round(snapshot.cash)}`;
  const lines: FinanceLine[] = [{ text: top, color: '#ee4' }];
  if (snapshot.debtRubles > 0) lines.push({ text: `долг ${compactRubles(snapshot.debtRubles)}`, color: '#f86' });
  if (state) {
    const pressure = economyPressureLine(state);
    if (pressure) lines.push(pressure);
  }
  return lines;
}

function inventoryFinanceLines(snapshot: FinanceSnapshot): FinanceLine[] {
  const lines: FinanceLine[] = [
    {
      text: snapshot.hasBanking
        ? `Наличные: ${compactRubles(snapshot.cash)}  Счет: ${compactRubles(snapshot.accountRubles)}`
        : `Наличные: ${compactRubles(snapshot.cash)}`,
      color: '#ee4',
    },
  ];
  if (snapshot.depositPrincipal > 0 || snapshot.depositYield > 0) {
    lines.push({
      text: `Депозит: ${compactRubles(snapshot.depositPrincipal)} +~${compactRubles(snapshot.depositYield)}`,
      color: '#8f8',
    });
  }
  if (snapshot.hasBanking && (snapshot.debtRubles > 0 || snapshot.creditLimit > 0)) {
    const limit = snapshot.creditLimit > 0 ? ` / лимит ${compactRubles(snapshot.creditLimit)}` : '';
    lines.push({
      text: `Долг: ${compactRubles(snapshot.debtRubles)}${limit}`,
      color: snapshot.debtRubles > 0 ? '#f86' : '#789',
    });
  }
  if (snapshot.hasStock) {
    lines.push({
      text: `Портфель: ${compactRubles(snapshot.portfolioValue)}  P/L ${formatSignedRubles(snapshot.portfolioPL)}`,
      color: snapshot.portfolioPL >= 0 ? '#8f8' : '#f86',
    });
  }
  return lines;
}

export function drawHudFinanceCompact(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  state: GameState,
  sx: number,
  sy: number,
  time: number,
  y: number,
): void {
  const lines = hudFinanceLines(readFinanceSnapshot(player, state), state);
  const w = ctx.canvas.width;
  const panelW = Math.min(116 * sx, w - 12 * sx);
  const lineH = 9 * sy;
  const panelH = (8 + lines.length * 9) * sy;
  const x = w - panelW - 6 * sx;
  if (panelW <= 24 * sx) return;

  ctx.save();
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 280);
  ctx.font = `${7 * sy}px monospace`;
  ctx.textAlign = 'left';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = lines[i].color;
    ctx.fillText(fitText(ctx, lines[i].text, panelW - 10 * sx), x + 5 * sx, y + (4 * sy) + i * lineH);
  }
  ctx.restore();
}

export function drawInventoryFinanceBlock(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  state: GameState,
  x: number,
  y: number,
  w: number,
  sy: number,
  time: number,
  maxBottom: number,
): number {
  const lines = inventoryFinanceLines(readFinanceSnapshot(player, state));
  const lineH = 7.2 * sy;
  const available = Math.max(1, Math.floor((maxBottom - y - 7 * sy) / lineH));
  const visible = lines.slice(0, available);
  if (visible.length === 0) return y;

  drawGlitchText(ctx, 'ФИНАНСЫ', x, y, time, 830, '#6cf', 6 * sy);
  let cy = y + 8.4 * sy;
  ctx.font = `${5.8 * sy}px monospace`;
  for (const line of visible) {
    ctx.fillStyle = line.color;
    ctx.fillText(fitText(ctx, line.text, w), x, cy);
    cy += lineH;
  }
  return cy + 2.2 * sy;
}

export function hasInventoryRoom(inv: readonly { defId: string; count: number; data?: unknown }[] | undefined, defId: string): boolean {
  const def = ITEMS[defId];
  if (!def) return false;
  const slots = inv ?? [];
  const stack = getStack(def);
  for (const slot of slots) {
    if (slot.defId === defId && slot.count < stack && slot.data === undefined) return true;
  }
  return slots.length < MAX_INVENTORY_SLOTS;
}

export function tradeCellPriceDisplay(
  state: GameState,
  npc: Entity,
  defId: string,
  side: 'buy' | 'sell',
): TradeCellPriceDisplay {
  let price = getAdjustedItemPrice(state, defId);
  let scarcity = getItemPriceMultiplier(state, defId);
  try {
    const quote = getEconomyQuote(state, defId, { trader: npc });
    price = side === 'buy' ? quote.buyPrice : quote.sellPrice;
    scarcity = quote.scarcityMultiplier;
  } catch {
    // Partially merged economy data must not break menu rendering.
  }
  const band = scarcityBand(scarcity);
  const questState = questItemState(state, defId);
  return {
    text: compactRubles(price),
    color: price > 0 ? '#da4' : '#777',
    scarcityColor: band.color,
    scarcityLabel: band.short,
    questState,
  };
}

export function itemValueDisplay(state: GameState, defId: string): ItemValueDisplay {
  let price = getAdjustedItemPrice(state, defId);
  let scarcity = getItemPriceMultiplier(state, defId);
  let resourceId: string | undefined;
  try {
    const quote = getEconomyQuote(state, defId);
    resourceId = quote.resourceId;
    scarcity = quote.scarcityMultiplier;
    price = getAdjustedItemPrice(state, defId);
  } catch {
    // Keep loot/container UI readable even while economy definitions are incomplete.
  }
  const band = scarcityBand(scarcity);
  const resource = shortResourceName(resourceId);
  return {
    priceText: compactRubles(price),
    line: `Оценка: ${compactRubles(price)} | ${band.label} ${formatMult(scarcity)}`,
    detail: resource ? `Ресурс: ${resource}` : 'Ресурс: вне складского дефицита',
    scarcityColor: band.color,
    questState: questItemState(state, defId),
  };
}

export function tradePriceDisplay(
  state: GameState,
  player: Entity,
  npc: Entity,
  defId: string,
  side: 'buy' | 'sell',
): TradePriceDisplay {
  let price = getAdjustedItemPrice(state, defId);
  let demand = 1;
  let scarcity = getItemPriceMultiplier(state, defId);
  let tariff = 1;
  let resourceId: string | undefined;
  let basePrice = ITEMS[defId]?.value ?? 0;
  try {
    const quote = getEconomyQuote(state, defId, { trader: npc });
    price = side === 'buy' ? quote.buyPrice : quote.sellPrice;
    demand = quote.demandMultiplier;
    scarcity = quote.scarcityMultiplier;
    tariff = quote.tariffMultiplier;
    resourceId = quote.resourceId;
    basePrice = quote.basePrice;
  } catch {
    // Rendering must stay graceful if a partially merged economy system cannot quote yet.
  }
  const band = scarcityBand(scarcity);
  const reasons = [`спрос ${formatMult(demand)}`, `дефицит ${formatMult(scarcity)}`];
  if (Math.abs(tariff - 1) > 0.04) reasons.push(`тариф ${formatMult(tariff)}`);
  const label = side === 'buy' ? 'Цена' : 'Скупка';
  const payer = side === 'buy' ? player : npc;
  const receiver = side === 'buy' ? player : npc;
  const hasMoney = (payer.money ?? 0) >= price;
  const hasSpace = hasInventoryRoom(receiver.inventory, defId);
  const ok = hasMoney && hasSpace;
  const status = ok
    ? side === 'buy' ? `${controlHint('gameMenu')} купить` : `${controlHint('gameMenu')} продать`
    : !hasMoney
      ? side === 'buy' ? 'не хватает денег' : 'у торговца нет денег'
      : side === 'buy' ? 'нет места' : 'у торговца нет места';

  return {
    price,
    line: `${label}: ${price}₽ ${reasons.join(' ')}`,
    detail: `База ${compactRubles(basePrice)}${resourceId ? ` | ${shortResourceName(resourceId)}` : ''}`,
    scarcity: `${band.label} ${formatMult(scarcity)}`,
    scarcityColor: band.color,
    status,
    color: ok ? '#da4' : '#f84',
    ok,
  };
}
