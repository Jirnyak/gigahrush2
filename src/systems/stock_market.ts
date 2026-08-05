import { type GameState, type WorldEvent } from '../core/types';
import { CORPORATIONS, CORPORATION_BY_ID, type CorporationDef, type CorporationId } from '../data/corporations';
import {
  STOCK_MARKET_COMMISSION_RATE,
  STOCK_MARKET_EVENT_CAP_PER_TICK,
  STOCK_MARKET_MAX_DRIFT,
  STOCK_MARKET_MAX_EVENT_MOVE,
  STOCK_MARKET_MAX_RANDOM_MOVE,
  STOCK_MARKET_MIN_COMMISSION,
  STOCK_MARKET_PRICE_MAX,
  STOCK_MARKET_PRICE_MIN,
  STOCK_MARKET_RANDOM_TICK_SEC,
  STOCK_MARKET_RECENT_TRADES_CAP,
  STOCK_MARKET_SPREAD_RATE,
} from '../data/stock_market';
import { ensureBankingState } from './banking';
import { getRecentEvents, publishEvent } from './events';
import { getNetMarketSnapshot, type NetMarketSnapshot } from './net_sphere';

export interface StockQuote {
  price: number;
  lastDelta: number;
  drift: number;
  volume: number;
  lastTickAt: number;
}

export interface StockHolding {
  shares: number;
  avgPrice: number;
}

export interface StockTrade {
  id: number;
  time: number;
  corpId: CorporationId;
  side: 'buy' | 'sell';
  shares: number;
  unitPrice: number;
  gross: number;
  fee: number;
  total: number;
}

export interface StockMarketState {
  quotes: Record<CorporationId, StockQuote>;
  portfolio: Record<CorporationId, StockHolding>;
  lastEventId: number;
  lastRandomTickAt: number;
  lastRemoteUpdatedAt: number;
  recentTrades: StockTrade[];
  nextTradeId: number;
}

export interface StockTradeResult {
  ok: boolean;
  reason?: 'unknown_corp' | 'invalid_shares' | 'insufficient_funds' | 'insufficient_shares';
  corpId?: CorporationId;
  shares?: number;
  unitPrice?: number;
  fee?: number;
  total?: number;
  accountRubles?: number;
}

export interface StockMarketSnapshotRow {
  corpId: CorporationId;
  name: string;
  ticker: string;
  sector: string;
  price: number;
  lastDelta: number;
  drift: number;
  volume: number;
  shares: number;
  avgPrice: number;
  value: number;
}

export interface StockMarketSnapshot {
  accountRubles: number;
  portfolioValue: number;
  quotes: StockMarketSnapshotRow[];
  recentTrades: StockTrade[];
  lastEventId: number;
  lastRandomTickAt: number;
}

type StockMarketHost = GameState & { stockMarket?: StockMarketState };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cleanNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPrice(value: number): number {
  return roundMoney(clamp(value, STOCK_MARKET_PRICE_MIN, STOCK_MARKET_PRICE_MAX));
}

function createQuote(corp: CorporationDef): StockQuote {
  return {
    price: corp.basePrice,
    lastDelta: 0,
    drift: 0,
    volume: 0,
    lastTickAt: 0,
  };
}

function createStockMarketState(): StockMarketState {
  const quotes: Record<CorporationId, StockQuote> = {};
  for (const corp of CORPORATIONS) quotes[corp.id] = createQuote(corp);
  return {
    quotes,
    portfolio: {},
    lastEventId: 0,
    lastRandomTickAt: 0,
    lastRemoteUpdatedAt: 0,
    recentTrades: [],
    nextTradeId: 1,
  };
}

function normalizeQuote(value: unknown, corp: CorporationDef): StockQuote {
  const src = value && typeof value === 'object' ? value as Partial<StockQuote> : {};
  return {
    price: clampPrice(cleanNumber(src.price, corp.basePrice)),
    lastDelta: roundMoney(cleanNumber(src.lastDelta, 0)),
    drift: clamp(cleanNumber(src.drift, 0), -STOCK_MARKET_MAX_DRIFT, STOCK_MARKET_MAX_DRIFT),
    volume: Math.max(0, Math.floor(cleanNumber(src.volume, 0))),
    lastTickAt: Math.max(0, cleanNumber(src.lastTickAt, 0)),
  };
}

function normalizeHolding(value: unknown): StockHolding | null {
  const src = value && typeof value === 'object' ? value as Partial<StockHolding> : {};
  const shares = Math.max(0, Math.floor(cleanNumber(src.shares, 0)));
  if (shares <= 0) return null;
  return {
    shares,
    avgPrice: roundMoney(Math.max(0, cleanNumber(src.avgPrice, 0))),
  };
}

function normalizeTrade(value: unknown): StockTrade | null {
  const src = value && typeof value === 'object' ? value as Partial<StockTrade> : {};
  const corpId = typeof src.corpId === 'string' && CORPORATION_BY_ID[src.corpId] ? src.corpId : '';
  const side = src.side === 'buy' || src.side === 'sell' ? src.side : undefined;
  const shares = Math.max(0, Math.floor(cleanNumber(src.shares, 0)));
  if (!corpId || !side || shares <= 0) return null;
  return {
    id: Math.max(1, Math.floor(cleanNumber(src.id, 1))),
    time: Math.max(0, cleanNumber(src.time, 0)),
    corpId,
    side,
    shares,
    unitPrice: roundMoney(Math.max(0, cleanNumber(src.unitPrice, 0))),
    gross: roundMoney(Math.max(0, cleanNumber(src.gross, 0))),
    fee: roundMoney(Math.max(0, cleanNumber(src.fee, 0))),
    total: roundMoney(Math.max(0, cleanNumber(src.total, 0))),
  };
}

export function normalizeStockMarketState(value: unknown): StockMarketState {
  const src = value && typeof value === 'object' ? value as Partial<StockMarketState> : {};
  const out = createStockMarketState();

  if (src.quotes && typeof src.quotes === 'object') {
    for (const corp of CORPORATIONS) out.quotes[corp.id] = normalizeQuote(src.quotes[corp.id], corp);
  }
  if (src.portfolio && typeof src.portfolio === 'object') {
    for (const corp of CORPORATIONS) {
      const holding = normalizeHolding(src.portfolio[corp.id]);
      if (holding) out.portfolio[corp.id] = holding;
    }
  }
  out.lastEventId = Math.max(0, Math.floor(cleanNumber(src.lastEventId, 0)));
  out.lastRandomTickAt = Math.max(0, cleanNumber(src.lastRandomTickAt, 0));
  out.lastRemoteUpdatedAt = Math.max(0, cleanNumber(src.lastRemoteUpdatedAt, 0));
  out.recentTrades = Array.isArray(src.recentTrades)
    ? src.recentTrades.map(normalizeTrade).filter((trade): trade is StockTrade => trade !== null).slice(-STOCK_MARKET_RECENT_TRADES_CAP)
    : [];
  out.nextTradeId = Math.max(
    Math.floor(cleanNumber(src.nextTradeId, 1)),
    out.recentTrades.reduce((max, trade) => Math.max(max, trade.id + 1), 1),
  );
  return out;
}

export function ensureStockMarketState(state: GameState): StockMarketState {
  const host = state as StockMarketHost;
  if (!host.stockMarket) {
    host.stockMarket = normalizeStockMarketState(undefined);
    return host.stockMarket;
  }
  Object.assign(host.stockMarket, normalizeStockMarketState(host.stockMarket));
  return host.stockMarket;
}

export function normalizeGameStockMarket(state: GameState, saved: unknown): void {
  (state as StockMarketHost).stockMarket = normalizeStockMarketState(saved);
}

export function stockMarketForSave(state: GameState): StockMarketState {
  return normalizeStockMarketState(ensureStockMarketState(state));
}

function ensureBankingAccount(state: GameState): { accountRubles: number } {
  return ensureBankingState(state);
}

function tradeUnitPrice(quote: StockQuote, side: 'buy' | 'sell'): number {
  const spread = side === 'buy' ? 1 + STOCK_MARKET_SPREAD_RATE : 1 - STOCK_MARKET_SPREAD_RATE;
  return clampPrice(quote.price * spread);
}

function tradeFee(gross: number): number {
  return roundMoney(Math.max(STOCK_MARKET_MIN_COMMISSION, gross * STOCK_MARKET_COMMISSION_RATE));
}

function pushTrade(market: StockMarketState, trade: Omit<StockTrade, 'id'>): StockTrade {
  const saved: StockTrade = { ...trade, id: market.nextTradeId++ };
  market.recentTrades.push(saved);
  if (market.recentTrades.length > STOCK_MARKET_RECENT_TRADES_CAP) {
    market.recentTrades.splice(0, market.recentTrades.length - STOCK_MARKET_RECENT_TRADES_CAP);
  }
  return saved;
}

function stockTags(corp: CorporationDef, side: 'buy' | 'sell'): string[] {
  return ['stock_market', side === 'buy' ? 'buy_shares' : 'sell_shares', 'corp', `corp_${corp.id}`, corp.ticker.toLowerCase(), corp.sector];
}

function publishTradeEvent(
  state: GameState,
  corp: CorporationDef,
  side: 'buy' | 'sell',
  trade: StockTrade,
  accountRubles: number,
): void {
  publishEvent(state, {
    type: side === 'sell' ? 'player_sell_item' : 'player_handoff_item',
    severity: trade.total >= 500 ? 3 : 2,
    privacy: 'private',
    tags: stockTags(corp, side),
    itemId: corp.id,
    itemName: corp.name,
    itemCount: trade.shares,
    itemValue: trade.total,
    data: {
      action: side === 'buy' ? 'buy_shares' : 'sell_shares',
      corpId: corp.id,
      ticker: corp.ticker,
      shares: trade.shares,
      unitPrice: trade.unitPrice,
      gross: trade.gross,
      fee: trade.fee,
      total: trade.total,
      accountRubles,
    },
  });
}

export function buyShares(state: GameState, corpId: CorporationId, shares: number): StockTradeResult {
  const corp = CORPORATION_BY_ID[corpId];
  if (!corp) return { ok: false, reason: 'unknown_corp', corpId };
  const amount = Math.floor(shares);
  if (!Number.isFinite(shares) || amount <= 0 || amount !== shares) return { ok: false, reason: 'invalid_shares', corpId };

  const market = ensureStockMarketState(state);
  const quote = market.quotes[corp.id];
  const unitPrice = tradeUnitPrice(quote, 'buy');
  const gross = roundMoney(unitPrice * amount);
  const fee = tradeFee(gross);
  const total = roundMoney(gross + fee);
  const bank = ensureBankingAccount(state);
  if (bank.accountRubles < total) {
    return { ok: false, reason: 'insufficient_funds', corpId, shares: amount, unitPrice, fee, total, accountRubles: bank.accountRubles };
  }

  bank.accountRubles = roundMoney(bank.accountRubles - total);
  const holding = market.portfolio[corp.id] ?? { shares: 0, avgPrice: 0 };
  const nextShares = holding.shares + amount;
  holding.avgPrice = roundMoney(((holding.avgPrice * holding.shares) + total) / nextShares);
  holding.shares = nextShares;
  market.portfolio[corp.id] = holding;
  quote.volume += amount;

  const trade = pushTrade(market, { time: state.time, corpId: corp.id, side: 'buy', shares: amount, unitPrice, gross, fee, total });
  publishTradeEvent(state, corp, 'buy', trade, bank.accountRubles);
  return { ok: true, corpId, shares: amount, unitPrice, fee, total, accountRubles: bank.accountRubles };
}

export function sellShares(state: GameState, corpId: CorporationId, shares: number): StockTradeResult {
  const corp = CORPORATION_BY_ID[corpId];
  if (!corp) return { ok: false, reason: 'unknown_corp', corpId };
  const amount = Math.floor(shares);
  if (!Number.isFinite(shares) || amount <= 0 || amount !== shares) return { ok: false, reason: 'invalid_shares', corpId };

  const market = ensureStockMarketState(state);
  const holding = market.portfolio[corp.id];
  if (!holding || holding.shares < amount) return { ok: false, reason: 'insufficient_shares', corpId, shares: amount };

  const quote = market.quotes[corp.id];
  const unitPrice = tradeUnitPrice(quote, 'sell');
  const gross = roundMoney(unitPrice * amount);
  const fee = tradeFee(gross);
  const total = roundMoney(Math.max(0, gross - fee));
  const bank = ensureBankingAccount(state);
  bank.accountRubles = roundMoney(bank.accountRubles + total);

  holding.shares -= amount;
  if (holding.shares <= 0) delete market.portfolio[corp.id];
  quote.volume += amount;

  const trade = pushTrade(market, { time: state.time, corpId: corp.id, side: 'sell', shares: amount, unitPrice, gross, fee, total });
  publishTradeEvent(state, corp, 'sell', trade, bank.accountRubles);
  return { ok: true, corpId, shares: amount, unitPrice, fee, total, accountRubles: bank.accountRubles };
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitNoise(corpId: string, bucket: number, tick: number): number {
  let h = hashString(corpId);
  h ^= Math.imul(bucket + 0x9e3779b9, 2246822519);
  h ^= Math.imul(tick + 0x85ebca6b, 3266489917);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

function applyRelativeMove(quote: StockQuote, relativeMove: number, now: number): void {
  const oldPrice = quote.price;
  quote.price = clampPrice(oldPrice * (1 + relativeMove));
  quote.lastDelta = roundMoney(quote.price - oldPrice);
  quote.lastTickAt = now;
}

function applyRandomTick(state: GameState, market: StockMarketState): void {
  if (state.time < market.lastRandomTickAt + STOCK_MARKET_RANDOM_TICK_SEC) return;
  const bucket = Math.floor(state.time / STOCK_MARKET_RANDOM_TICK_SEC);
  for (const corp of CORPORATIONS) {
    const quote = market.quotes[corp.id];
    const noise = unitNoise(corp.id, bucket, state.tick) - 0.5;
    quote.drift = clamp(quote.drift * 0.82 + noise * corp.volatility * 0.55, -STOCK_MARKET_MAX_DRIFT, STOCK_MARKET_MAX_DRIFT);
    const move = clamp(quote.drift * 0.22 + noise * corp.volatility, -STOCK_MARKET_MAX_RANDOM_MOVE, STOCK_MARKET_MAX_RANDOM_MOVE);
    applyRelativeMove(quote, move, state.time);
  }
  market.lastRandomTickAt = state.time;
}

function tagHit(event: WorldEvent, tags: readonly string[]): number {
  let hits = 0;
  for (const tag of tags) {
    if (event.tags.includes(tag)) hits++;
  }
  return hits;
}

function factoryHit(event: WorldEvent, corp: CorporationDef): boolean {
  return corp.factoryIds.some(id => event.tags.includes(id) || event.data?.factoryId === id);
}

function eventImpulseForCorp(event: WorldEvent, corp: CorporationDef): number {
  let impulse = 0;
  const severityScale = 0.75 + event.severity * 0.12;

  if (event.type === 'room_produced_items' && factoryHit(event, corp)) impulse += 0.035;
  if ((event.type === 'room_lacked_resources' || event.type === 'room_blocked_production') && factoryHit(event, corp)) impulse -= 0.04;

  const positiveHits = tagHit(event, corp.positiveEventTags);
  const negativeHits = tagHit(event, corp.negativeEventTags);
  impulse += positiveHits * 0.014;
  impulse -= negativeHits * 0.018;

  const industrialKill = (event.type === 'player_kill_monster' || event.type === 'npc_kill_monster')
    && (event.tags.includes('monster_robot')
      || event.tags.includes('monster_rebar')
      || event.tags.includes('monster_kostorez')
      || event.tags.includes('monster_betonnik')
      || event.tags.includes('industrial'));
  if (industrialKill && (corp.sector === 'heavy_industry' || corp.sector === 'metallurgy' || corp.resourceIds.includes('metal'))) {
    impulse += 0.026;
  }

  const slimeScience = event.tags.includes('slime') || event.tags.includes('sample') || event.tags.includes('science');
  if (slimeScience && corp.sector === 'science') impulse += 0.028;
  if (slimeScience && corp.id === 'zhelemish_pischeprom' && event.tags.includes('zhelemish')) impulse += 0.02;

  const logistics = event.tags.includes('caravan')
    || event.tags.includes('caravan_route')
    || event.tags.includes('tariff')
    || event.type === 'contract_completed';
  if (logistics && corp.sector === 'logistics') impulse += 0.025;
  if (event.type === 'contract_failed' && corp.sector === 'logistics') impulse -= 0.025;

  return clamp(impulse * severityScale, -STOCK_MARKET_MAX_EVENT_MOVE, STOCK_MARKET_MAX_EVENT_MOVE);
}

function applyEventTicks(state: GameState, market: StockMarketState): void {
  const recent = getRecentEvents(state, { sinceId: market.lastEventId, limit: STOCK_MARKET_EVENT_CAP_PER_TICK });
  if (recent.length === 0) return;

  for (const event of recent.slice().reverse()) {
    market.lastEventId = Math.max(market.lastEventId, event.id);
    if (event.tags.includes('stock_market')) continue;
    for (const corp of CORPORATIONS) {
      const impulse = eventImpulseForCorp(event, corp);
      if (impulse === 0) continue;
      const quote = market.quotes[corp.id];
      quote.drift = clamp(quote.drift + impulse * 0.35, -STOCK_MARKET_MAX_DRIFT, STOCK_MARKET_MAX_DRIFT);
      applyRelativeMove(quote, impulse, state.time);
    }
  }
}

function remoteSnapshotUpdatedAt(snapshot: NetMarketSnapshot): number {
  return snapshot.rows.reduce((best, row) => Math.max(best, row.updatedAt), snapshot.updatedAt);
}

function applyRemoteSnapshotToMarket(state: GameState, market: StockMarketState, snapshot: NetMarketSnapshot | null): void {
  if (!snapshot) return;
  const updatedAt = remoteSnapshotUpdatedAt(snapshot);
  if (updatedAt <= market.lastRemoteUpdatedAt) return;

  for (const row of snapshot.rows) {
    const corp = CORPORATION_BY_ID[row.corpId];
    if (!corp) continue;
    const quote = market.quotes[corp.id];
    const oldPrice = quote.price;
    const remotePrice = clampPrice(row.price);
    const maxStep = Math.max(0.05, oldPrice * 0.025);
    const softDelta = clamp((remotePrice - oldPrice) * 0.18, -maxStep, maxStep);
    quote.price = clampPrice(oldPrice + softDelta);
    quote.lastDelta = roundMoney(quote.price - oldPrice);
    quote.drift = clamp(
      quote.drift + clamp(row.lastDelta / Math.max(1, remotePrice), -0.05, 0.05) * 0.2,
      -STOCK_MARKET_MAX_DRIFT,
      STOCK_MARKET_MAX_DRIFT,
    );
    quote.volume = Math.max(quote.volume, Math.floor(row.volume));
    quote.lastTickAt = Math.max(quote.lastTickAt, state.time);
  }
  market.lastRemoteUpdatedAt = updatedAt;
}

export function applyRemoteStockMarketSnapshot(state: GameState, snapshot: NetMarketSnapshot | null): void {
  applyRemoteSnapshotToMarket(state, ensureStockMarketState(state), snapshot);
}

export function tickStockMarket(state: GameState): void {
  const market = ensureStockMarketState(state);
  applyEventTicks(state, market);
  applyRandomTick(state, market);
  applyRemoteSnapshotToMarket(state, market, getNetMarketSnapshot());
}

export function portfolioValue(state: GameState): number {
  const market = ensureStockMarketState(state);
  let total = 0;
  for (const corp of CORPORATIONS) {
    const holding = market.portfolio[corp.id];
    if (!holding) continue;
    total += holding.shares * market.quotes[corp.id].price;
  }
  return roundMoney(total);
}

export function stockMarketSnapshot(state: GameState): StockMarketSnapshot {
  const market = ensureStockMarketState(state);
  const bank = ensureBankingAccount(state);
  return {
    accountRubles: bank.accountRubles,
    portfolioValue: portfolioValue(state),
    quotes: CORPORATIONS.map(corp => {
      const quote = market.quotes[corp.id];
      const holding = market.portfolio[corp.id] ?? { shares: 0, avgPrice: 0 };
      return {
        corpId: corp.id,
        name: corp.name,
        ticker: corp.ticker,
        sector: corp.sector,
        price: quote.price,
        lastDelta: quote.lastDelta,
        drift: quote.drift,
        volume: quote.volume,
        shares: holding.shares,
        avgPrice: holding.avgPrice,
        value: roundMoney(holding.shares * quote.price),
      };
    }),
    recentTrades: market.recentTrades.slice(),
    lastEventId: market.lastEventId,
    lastRandomTickAt: market.lastRandomTickAt,
  };
}

export function summarizeStockMarket(state: GameState, limit = 5): string[] {
  const snapshot = stockMarketSnapshot(state);
  const rows = snapshot.quotes
    .slice()
    .sort((a, b) => Math.abs(b.lastDelta) - Math.abs(a.lastDelta))
    .slice(0, limit)
    .map(row => `${row.ticker}: ${row.price.toFixed(2)}₽ ${row.lastDelta >= 0 ? '+' : ''}${row.lastDelta.toFixed(2)}`);
  return [`счет ${snapshot.accountRubles.toFixed(2)}₽ портфель ${snapshot.portfolioValue.toFixed(2)}₽`, ...rows];
}
