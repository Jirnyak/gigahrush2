import {
  type Entity,
  type GameState,
  type Item,
  type ItemDef,
  type RPGStats,
  type WorldEventSeverity,
  Faction,
  FloorLevel,
  Occupation,
} from '../core/types';
import { ITEMS } from '../data/catalog';
import { type EconomyState, createEconomyFloorState, createEconomyState, normalizeEconomyState } from '../data/economy';
import { occupationHasTradeTag } from '../data/occupation_profiles';
import { clamp } from '../core/math';
import {
  DEFAULT_TRADE_SPREAD,
  ECONOMY_DEMAND_RULES,
  ECONOMY_TARIFF_RULES,
  ECONOMY_TRADE_SPREAD_RULES,
  type EconomyFloorRef,
  type EconomyTradeSpreadRule,
} from '../data/economy_rules';
import { RESOURCES, RESOURCE_BY_ID, type ResourceDef, resourceForItem, resourceForItemType } from '../data/resources';
import {
  publishEvent,
  publishResourceScarcityEvent,
  type ResourceScarcityBand,
  type ResourceScarcityTrend,
} from './events';
import { intContractRewardMult } from './rpg';

type EconomyGameState = GameState & { economy?: EconomyState };
type CachedPrice = { price: number; multiplier: number };
type PriceCache = { floor: FloorLevel; version: number; items: Map<string, CachedPrice> };

export interface EconomyQuoteOptions {
  floor?: EconomyFloorRef;
  stockFloor?: FloorLevel;
  trader?: Entity;
  traderFaction?: Faction;
  traderOccupation?: Occupation;
  tariffMultiplier?: number;
  tags?: readonly string[];
  reason?: string;
}

export interface EconomyQuote {
  basePrice: number;
  scarcityMultiplier: number;
  demandMultiplier: number;
  tariffMultiplier: number;
  buyPrice: number;
  sellPrice: number;
  resourceId?: string;
  tags: string[];
  reason: string;
}

export interface EconomyTariffProviderResult {
  multiplier: number;
  tags?: readonly string[];
  reason?: string;
}

export interface EconomyTariffProvider {
  id: string;
  quote(state: GameState, resourceId: string | undefined, floor: EconomyFloorRef): EconomyTariffProviderResult | undefined;
}

export interface PlayerItemSaleRecordOptions {
  tags?: readonly string[];
  data?: Record<string, unknown>;
}

export interface ResourceStockChangeOptions {
  zoneId?: number;
  roomId?: number;
  reason?: string;
  tags?: readonly string[];
}

interface RuleSummary {
  multiplier: number;
  tags: string[];
  reasons: string[];
}

const MAX_PRICE_CACHE_ITEMS = 256;
const MAX_QUOTE_TAGS = 24;
const DEFAULT_SCARCITY_MAX = 4;
const DEFAULT_PRICE_PRESSURE_MAX = 5;
const DEFAULT_REWARD_PRESSURE_MAX = 3;
const SURPLUS_SCARCITY_MIN = 0.65;
const RESOURCE_STRAINED_MULT = 1.5;
const priceCaches = new WeakMap<GameState, PriceCache>();
var tariffProviders: EconomyTariffProvider[] | undefined;
const RESOURCE_SCARCITY_RANK: Record<ResourceScarcityBand, number> = {
  normal: 0,
  strained: 1,
  shortage: 2,
  critical: 3,
};

function pushTag(out: string[], tag: string | undefined): void {
  if (!tag || out.length >= MAX_QUOTE_TAGS || out.includes(tag)) return;
  out.push(tag);
}

function pushTags(out: string[], tags: readonly string[] | undefined): void {
  if (!tags) return;
  for (const tag of tags) pushTag(out, tag);
}

function floorMatches(ruleFloor: EconomyFloorRef | undefined, floor: EconomyFloorRef): boolean {
  return ruleFloor === undefined || ruleFloor === floor;
}

function clampRuleMultiplier(value: number): number {
  return Number.isFinite(value) ? Math.max(0.1, Math.min(6, value)) : 1;
}

function smooth01(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function resourceScarcityCap(res: ResourceDef): number {
  return clamp(res.scarcityMax ?? DEFAULT_SCARCITY_MAX, 1, DEFAULT_SCARCITY_MAX);
}

function resourcePricePressureCap(res: ResourceDef | undefined): number {
  return clamp(res?.pricePressureMax ?? DEFAULT_PRICE_PRESSURE_MAX, 1, DEFAULT_PRICE_PRESSURE_MAX);
}

function resourceRewardPressureCap(res: ResourceDef | undefined, maxMultiplier: number): number {
  const requested = Number.isFinite(maxMultiplier) ? maxMultiplier : DEFAULT_REWARD_PRESSURE_MAX;
  return clamp(Math.min(requested, res?.rewardPressureMax ?? DEFAULT_REWARD_PRESSURE_MAX), 1, DEFAULT_REWARD_PRESSURE_MAX);
}

function scarcityMultiplierFor(res: ResourceDef, stock: { stock: number; target: number }): number {
  const target = Math.max(1, stock.target);
  const current = Math.max(0, stock.stock);
  const maxScarcity = resourceScarcityCap(res);
  if (current >= target) {
    const surplus = smooth01((current - target) / target);
    return clamp(1 - surplus * (1 - SURPLUS_SCARCITY_MIN), SURPLUS_SCARCITY_MIN, maxScarcity);
  }
  const lowStock = clamp(res.lowStock, 0, target - 1);
  const pressure = smooth01((target - current) / Math.max(1, target - lowStock));
  return clamp(1 + pressure * (maxScarcity - 1), SURPLUS_SCARCITY_MIN, maxScarcity);
}

function pricePressureMultiplier(
  res: ResourceDef | undefined,
  scarcityMultiplier: number,
  demandMultiplier: number,
  tariffMultiplier: number,
): number {
  const raw = scarcityMultiplier * demandMultiplier * tariffMultiplier;
  return clamp(raw, 0.1, resourcePricePressureCap(res));
}

function scarcityBandFor(res: ResourceDef, stock: number, target: number): ResourceScarcityBand {
  const low = Math.max(1, res.lowStock);
  if (stock <= Math.max(0, low * 0.5)) return 'critical';
  if (stock <= low) return 'shortage';
  const strainedAt = Math.min(Math.max(low + 1, low * RESOURCE_STRAINED_MULT), Math.max(low + 1, target - 1));
  return stock <= strainedAt ? 'strained' : 'normal';
}

function severityForBand(band: ResourceScarcityBand, trend: ResourceScarcityTrend): WorldEventSeverity {
  if (band === 'critical') return 5;
  if (band === 'shortage') return 4;
  return trend === 'recovered' ? 3 : 3;
}

function scarcityRumorIds(resourceId: string, trend: ResourceScarcityTrend): string[] {
  if (trend === 'recovered') return ['economy_resource_recovered'];
  switch (resourceId) {
    case 'drink_water':
      return ['economy_water_price', 'contract_scarcity_pressure'];
    case 'medicine':
      return ['economy_med_shortage', 'contract_scarcity_pressure'];
    case 'food':
      return ['economy_kitchen_stock', 'contract_scarcity_pressure'];
    case 'ammo':
      return ['contract_liquidator_board', 'contract_scarcity_pressure'];
    case 'documents':
    case 'paper':
      return ['contract_admin_papers', 'contract_scarcity_pressure'];
    default:
      return ['economy_resource_pressure', 'contract_scarcity_pressure'];
  }
}

function stockFloorFor(state: GameState, opts: EconomyQuoteOptions): FloorLevel {
  if (opts.stockFloor !== undefined) return opts.stockFloor;
  return typeof opts.floor === 'number' ? opts.floor : state.currentFloor;
}

function demandFor(resourceId: string | undefined, floor: EconomyFloorRef): RuleSummary {
  const out: RuleSummary = { multiplier: 1, tags: [], reasons: [] };
  if (!resourceId) return out;
  for (const rule of ECONOMY_DEMAND_RULES) {
    if (rule.resourceId !== resourceId || !floorMatches(rule.floor, floor)) continue;
    out.multiplier *= clampRuleMultiplier(rule.multiplier);
    pushTags(out.tags, rule.tags);
    out.reasons.push(rule.reason);
  }
  return out;
}

function tariffFor(state: GameState, resourceId: string | undefined, floor: EconomyFloorRef, opts: EconomyQuoteOptions): RuleSummary {
  const out: RuleSummary = { multiplier: 1, tags: [], reasons: [] };
  for (const rule of ECONOMY_TARIFF_RULES) {
    if (resourceId && rule.resourceId !== undefined && rule.resourceId !== resourceId) continue;
    if (!floorMatches(rule.floor, floor)) continue;
    out.multiplier *= clampRuleMultiplier(rule.multiplier);
    pushTags(out.tags, rule.tags);
    out.reasons.push(rule.reason);
  }
  for (const provider of tariffProviders ?? []) {
    const dynamic = provider.quote(state, resourceId, floor);
    if (!dynamic) continue;
    out.multiplier *= clampRuleMultiplier(dynamic.multiplier);
    pushTags(out.tags, dynamic.tags);
    if (dynamic.reason) out.reasons.push(dynamic.reason);
  }
  if (opts.tariffMultiplier !== undefined) {
    out.multiplier *= clampRuleMultiplier(opts.tariffMultiplier);
    pushTag(out.tags, 'tariff_modifier');
    if (opts.reason) out.reasons.push(opts.reason);
  }
  return out;
}

function traderMatches(rule: EconomyTradeSpreadRule, faction: Faction | undefined, occupation: Occupation | undefined): boolean {
  if (rule.faction !== undefined && rule.faction !== faction) return false;
  if (rule.occupation !== undefined && rule.occupation !== occupation) return false;
  return rule.faction !== undefined || rule.occupation !== undefined;
}

function spreadFor(opts: EconomyQuoteOptions): EconomyTradeSpreadRule {
  const faction = opts.traderFaction ?? opts.trader?.faction;
  const occupation = opts.traderOccupation ?? opts.trader?.occupation;
  let selected = DEFAULT_TRADE_SPREAD;
  for (const rule of ECONOMY_TRADE_SPREAD_RULES) {
    if (traderMatches(rule, faction, occupation)) selected = rule;
  }
  return selected;
}

function roundedPrice(basePrice: number, multiplier: number): number {
  return Math.max(1, Math.round(basePrice * multiplier));
}

function quoteReason(reasons: string[]): string {
  if (reasons.includes('price_pressure_cap')) {
    return ['price_pressure_cap', ...reasons.filter(reason => reason !== 'price_pressure_cap')].slice(0, 4).join('+');
  }
  return reasons.slice(0, 4).join('+') || 'base_price';
}

function isEconomyState(value: unknown): value is EconomyState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EconomyState>;
  return typeof candidate.priceVersion === 'number'
    && !!candidate.floors
    && typeof candidate.floors === 'object';
}

export function registerEconomyTariffProvider(provider: EconomyTariffProvider): void {
  const providers = tariffProviders ?? (tariffProviders = []);
  const existing = providers.findIndex(entry => entry.id === provider.id);
  if (existing >= 0) {
    providers[existing] = provider;
  } else {
    providers.push(provider);
  }
}

export function ensureEconomyState(state: GameState): EconomyState {
  const econState = state as EconomyGameState;
  if (!isEconomyState(econState.economy)) {
    econState.economy = normalizeEconomyState(econState.economy ?? createEconomyState());
    priceCaches.delete(state);
  }
  if (!econState.economy.floors[state.currentFloor]) {
    econState.economy.floors[state.currentFloor] = createEconomyFloorState(state.currentFloor);
  }
  return econState.economy;
}

export function normalizeGameEconomy(state: GameState, saved: unknown): void {
  const econState = state as EconomyGameState;
  econState.economy = normalizeEconomyState(saved);
  priceCaches.delete(state);
  if (!econState.economy.floors[state.currentFloor]) {
    econState.economy.floors[state.currentFloor] = createEconomyFloorState(state.currentFloor);
  }
}

export function economyForSave(state: GameState): EconomyState {
  return ensureEconomyState(state);
}

export function invalidateEconomyPrices(state: GameState): void {
  ensureEconomyState(state).priceVersion++;
  priceCaches.delete(state);
}

export function getResourceScarcity(state: GameState, resourceId: string, floor: FloorLevel = state.currentFloor): number {
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[floor] ?? createEconomyFloorState(floor);
  econ.floors[floor] = floorState;
  const res = RESOURCE_BY_ID[resourceId];
  const stock = floorState.resources[resourceId];
  if (!res || !stock) return 1;
  return scarcityMultiplierFor(res, stock);
}

export function getResourceContractPressure(
  state: GameState,
  resourceId: string,
  floor: FloorLevel = state.currentFloor,
  maxMultiplier = DEFAULT_REWARD_PRESSURE_MAX,
): number {
  const rewardCap = resourceRewardPressureCap(RESOURCE_BY_ID[resourceId], maxMultiplier);
  return Math.min(rewardCap, Math.max(1, getResourceScarcity(state, resourceId, floor)));
}

function maybePublishScarcityThreshold(
  state: GameState,
  res: ResourceDef,
  previousStock: number,
  nextStock: number,
  floor: FloorLevel,
  opts: ResourceStockChangeOptions,
): void {
  const floorState = ensureEconomyState(state).floors[floor] ?? createEconomyFloorState(floor);
  const stock = floorState.resources[res.id];
  if (!stock) return;
  const previousBand = scarcityBandFor(res, previousStock, stock.target);
  const band = scarcityBandFor(res, nextStock, stock.target);
  if (previousBand === band) return;

  const prevRank = RESOURCE_SCARCITY_RANK[previousBand];
  const nextRank = RESOURCE_SCARCITY_RANK[band];
  const trend: ResourceScarcityTrend | undefined = nextRank > prevRank
    ? 'worsened'
    : prevRank > 0 ? 'recovered' : undefined;
  if (!trend) return;

  publishResourceScarcityEvent(state, {
    floor,
    zoneId: opts.zoneId,
    roomId: opts.roomId,
    resourceId: res.id,
    resourceName: res.name,
    stock: nextStock,
    target: stock.target,
    lowStock: res.lowStock,
    previousBand,
    band,
    trend,
    severity: severityForBand(band, trend),
    scarcityMultiplier: getResourceScarcity(state, res.id, floor),
    contractPressureMultiplier: getResourceContractPressure(state, res.id, floor),
    tags: opts.tags,
    reason: opts.reason,
    rumorIds: scarcityRumorIds(res.id, trend),
  });
}

export function changeResourceStock(
  state: GameState,
  resourceId: string,
  delta: number,
  floor: FloorLevel = state.currentFloor,
  opts: ResourceStockChangeOptions = {},
): boolean {
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[floor] ?? createEconomyFloorState(floor);
  econ.floors[floor] = floorState;
  const stock = floorState.resources[resourceId];
  if (!stock) return false;
  const previousStock = stock.stock;
  const next = clamp(stock.stock + delta, 0, Math.max(1, stock.target) * 2);
  stock.lastDelta = next - stock.stock;
  stock.stock = next;
  if (stock.lastDelta !== 0) {
    econ.priceVersion++;
    const res = RESOURCE_BY_ID[resourceId];
    if (res) maybePublishScarcityThreshold(state, res, previousStock, next, floor, opts);
  }
  floorState.lastTickAt = state.time;
  return true;
}

export function canSpendResources(state: GameState, inputs: { id: string; count: number }[], floor: FloorLevel = state.currentFloor): boolean {
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[floor] ?? createEconomyFloorState(floor);
  econ.floors[floor] = floorState;
  for (const i of inputs) {
    const stock = floorState.resources[i.id];
    if (!stock || stock.stock < i.count) return false;
  }
  return true;
}

export function spendResources(state: GameState, inputs: { id: string; count: number }[], floor: FloorLevel = state.currentFloor): boolean {
  if (!canSpendResources(state, inputs, floor)) return false;
  for (const i of inputs) changeResourceStock(state, i.id, -i.count, floor);
  return true;
}

function priceCacheFor(state: GameState): PriceCache {
  const econ = ensureEconomyState(state);
  let cache = priceCaches.get(state);
  if (!cache || cache.floor !== state.currentFloor || cache.version !== econ.priceVersion) {
    cache = { floor: state.currentFloor, version: econ.priceVersion, items: new Map() };
    priceCaches.set(state, cache);
  }
  return cache;
}

function cachedItemPrice(state: GameState, defId: string): CachedPrice {
  const cache = priceCacheFor(state);
  const cached = cache.items.get(defId);
  if (cached) return cached;
  const def = ITEMS[defId] as ItemDef | undefined;
  if (!def) return { price: 0, multiplier: 1 };
  const quote = getEconomyQuote(state, defId);
  const multiplier = quote.scarcityMultiplier;
  const price = roundedPrice(
    quote.basePrice,
    pricePressureMultiplier(quote.resourceId ? RESOURCE_BY_ID[quote.resourceId] : undefined, quote.scarcityMultiplier, quote.demandMultiplier, quote.tariffMultiplier),
  );
  const next = { price, multiplier };
  if (cache.items.size >= MAX_PRICE_CACHE_ITEMS) cache.items.clear();
  cache.items.set(defId, next);
  return next;
}

export function primeTradePriceCache(state: GameState, inventories: readonly (readonly Item[] | undefined)[]): void {
  for (const inv of inventories) {
    if (!inv) continue;
    for (const item of inv) cachedItemPrice(state, item.defId);
  }
}

export function getItemPriceMultiplier(state: GameState, defId: string): number {
  return cachedItemPrice(state, defId).multiplier;
}

export function getAdjustedItemPrice(state: GameState, defId: string): number {
  return cachedItemPrice(state, defId).price;
}

export function getEconomyQuote(state: GameState, defId: string, opts: EconomyQuoteOptions = {}): EconomyQuote {
  const def = ITEMS[defId] as ItemDef | undefined;
  if (!def) {
    return {
      basePrice: 0,
      scarcityMultiplier: 1,
      demandMultiplier: 1,
      tariffMultiplier: 1,
      buyPrice: 0,
      sellPrice: 0,
      tags: ['unknown_item'],
      reason: 'unknown_item',
    };
  }

  const floor = opts.floor ?? state.currentFloor;
  const resource = resourceForItem(defId) ?? resourceForItemType(def.type);
  const resourceId = resource?.id;
  const scarcityMultiplier = resourceId ? getResourceScarcity(state, resourceId, stockFloorFor(state, opts)) : 1;
  const demand = demandFor(resourceId, floor);
  const tariff = tariffFor(state, resourceId, floor, opts);
  const spread = spreadFor(opts);
  const basePrice = Math.max(0, def.value ?? 0);
  const rawAdjustedMultiplier = scarcityMultiplier * demand.multiplier * tariff.multiplier;
  const adjustedMultiplier = pricePressureMultiplier(resource, scarcityMultiplier, demand.multiplier, tariff.multiplier);
  const tags: string[] = ['economy'];
  if (resourceId) pushTag(tags, `res_${resourceId}`);
  pushTags(tags, demand.tags);
  pushTags(tags, tariff.tags);
  if (adjustedMultiplier < rawAdjustedMultiplier) pushTag(tags, 'price_cap');
  pushTags(tags, spread.tags);
  pushTags(tags, opts.tags);
  const reasons = [...demand.reasons, ...tariff.reasons];
  if (adjustedMultiplier < rawAdjustedMultiplier) reasons.push('price_pressure_cap');
  reasons.push(spread.reason);
  if (opts.reason && opts.tariffMultiplier === undefined) reasons.push(opts.reason);

  return {
    basePrice,
    scarcityMultiplier,
    demandMultiplier: demand.multiplier,
    tariffMultiplier: tariff.multiplier,
    buyPrice: roundedPrice(basePrice, adjustedMultiplier * spread.buyMultiplier),
    sellPrice: roundedPrice(basePrice, adjustedMultiplier * spread.sellMultiplier),
    resourceId,
    tags,
    reason: quoteReason(reasons),
  };
}

export function recordPlayerItemSale(
  state: GameState,
  seller: Entity,
  buyer: Entity,
  defId: string,
  count: number,
  unitPrice: number,
  zoneId?: number,
  opts: PlayerItemSaleRecordOptions = {},
): void {
  const def = ITEMS[defId];
  if (!def) return;

  const scienceValue = def.scienceValue ?? 0;
  const contrabandScore = def.contrabandScore ?? 0;
  const deceptiveScore = def.deceptiveScore ?? 0;

  const scienceBuyer = buyer.faction === Faction.SCIENTIST || occupationHasTradeTag(buyer.occupation, 'science');
  const blackMarketBuyer = occupationHasTradeTag(buyer.occupation, 'black_market')
    || buyer.faction === Faction.WILD
    || buyer.faction === Faction.CULTIST;

  const isContraband = contrabandScore > 50;
  const liquidatorConfiscation = isContraband && buyer.faction === Faction.LIQUIDATOR;

  let outcome = 'sale';

  if (scienceValue >= 50 && scienceBuyer) {
    outcome = 'science_handoff';
  } else if (isContraband && blackMarketBuyer) {
    outcome = 'contraband_sale';
  } else if (liquidatorConfiscation) {
    outcome = 'confiscation';
  } else if (isContraband || deceptiveScore >= 50) {
    outcome = 'pressure_sale';
  }

  let severity: WorldEventSeverity = 1;
  let privacy: 'private' | 'local' | 'witnessed' = 'private';

  if (deceptiveScore >= 80) {
    severity = 4;
    privacy = 'witnessed';
  } else if (liquidatorConfiscation) {
    severity = 4;
    privacy = 'local';
  } else if (isContraband) {
    severity = 3;
    privacy = 'local';
  }

  const tags = ['player', 'trade', outcome];
  pushTags(tags, opts.tags);
  if (isContraband) pushTags(tags, ['contraband', blackMarketBuyer ? 'black_market' : 'cash']);
  else pushTags(tags, [blackMarketBuyer ? 'black_market' : 'cash']);
  
  if (scienceBuyer) pushTags(tags, ['science']);
  if (liquidatorConfiscation) pushTags(tags, ['confiscation']);
  if (def.tags) pushTags(tags, def.tags);

  publishEvent(state, {
    type: (liquidatorConfiscation || (outcome === 'science_handoff' && !opts.tags?.includes('sell'))) ? 'player_handoff_item' : 'player_sell_item',
    zoneId,
    actorId: seller.id,
    actorName: seller.name ?? 'Вы',
    actorFaction: seller.faction,
    targetId: buyer.id,
    targetName: buyer.name,
    targetFaction: buyer.faction,
    itemId: defId,
    itemName: def.name,
    itemCount: count,
    itemValue: def.value,
    severity,
    privacy,
    tags,
    data: {
      unitPrice,
      totalPrice: unitPrice * count,
      price: unitPrice,
      direction: 'player_to_npc',
      outcome,
      deceptiveScore: deceptiveScore > 0 ? deceptiveScore : undefined,
      ...opts.data,
    },
  });
}

export function getScarcityAdjustedReward(
  state: GameState,
  resourceId: string,
  baseReward: number,
  floor: FloorLevel = state.currentFloor,
  maxMultiplier = 3,
  rpg?: RPGStats,
): number {
  const rewardCap = resourceRewardPressureCap(RESOURCE_BY_ID[resourceId], maxMultiplier);
  const multiplier = getResourceContractPressure(state, resourceId, floor, maxMultiplier);
  const intMultiplier = rpg ? intContractRewardMult(rpg) : 1;
  const totalMultiplier = Math.min(rewardCap + Math.max(0, intMultiplier - 1), multiplier * intMultiplier);
  return Math.max(1, Math.round(baseReward * totalMultiplier));
}

export function summarizeEconomy(state: GameState, limit = 8): string[] {
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[state.currentFloor] ?? createEconomyFloorState(state.currentFloor);
  econ.floors[state.currentFloor] = floorState;
  return RESOURCES.slice(0, limit).map(r => {
    const stock = floorState.resources[r.id];
    const mult = getResourceScarcity(state, r.id);
    return `${r.name}: ${Math.round(stock.stock)}/${stock.target} x${mult.toFixed(2)}`;
  });
}
