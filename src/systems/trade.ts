import { type Entity, type FloorLevel, type GameState, type Item } from '../core/types';
import { ITEMS } from '../data/catalog';
import { type EconomyFloorRef } from '../data/economy_rules';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { addItem } from './inventory';
import {
  changeResourceStock,
  getEconomyQuote,
  primeTradePriceCache,
  recordPlayerItemSale,
  type EconomyQuote,
  type EconomyQuoteOptions,
} from './economy';
import { publishEvent } from './events';
import { isGovnyakItem } from './govnyak';

export type TradeResultCode =
  | 'bought'
  | 'sold'
  | 'handoff'
  | 'deal_done'
  | 'offer_added'
  | 'offer_removed'
  | 'offer_full'
  | 'ask_added'
  | 'ask_removed'
  | 'ask_full'
  | 'no_item'
  | 'player_no_money'
  | 'player_no_space'
  | 'npc_no_money'
  | 'npc_no_space';

export interface TradeCreditSummary {
  creditValue: number;
  creditCount: number;
  fullPrice: number;
  cashDue: number;
  changeDue: number;
  surplus: number;
  npcOfferValue?: number;
  npcOfferCount?: number;
}

export interface TradeResult {
  ok: boolean;
  code: TradeResultCode;
  defId?: string;
  price?: number;
  quote?: EconomyQuote;
  credit?: TradeCreditSummary;
}

export interface TradeHookContext {
  state: GameState;
  player: Entity;
  npc: Entity;
  slotIndex: number;
}

export interface CompletedTradeContext extends TradeHookContext {
  defId: string;
  price: number;
  quote: EconomyQuote;
  zoneId?: number;
}

export interface TradeOptions {
  floor?: EconomyFloorRef;
  stockFloor?: FloorLevel;
  zoneId?: number;
  tariffMultiplier?: number;
  tags?: readonly string[];
  reason?: string;
  beforeSell?: (ctx: TradeHookContext) => boolean;
  afterSell?: (ctx: CompletedTradeContext) => void;
}

interface TradeOfferSession {
  playerOffer: Item[];
  npcOffer: Item[];
}

export const TRADE_OFFER_SLOT_CAP = MAX_INVENTORY_SLOTS;

const tradeOfferSessions = new WeakMap<GameState, TradeOfferSession>();

function tradeOfferSession(state: GameState): TradeOfferSession {
  let session = tradeOfferSessions.get(state);
  if (!session) {
    session = { playerOffer: [], npcOffer: [] };
    tradeOfferSessions.set(state, session);
  }
  return session;
}

export function clearTradeOffers(state: GameState): void {
  const session = tradeOfferSessions.get(state);
  if (!session) return;
  session.playerOffer.length = 0;
  session.npcOffer.length = 0;
}

export function getTradeOffer(state: GameState): readonly Item[] {
  return tradeOfferSession(state).playerOffer;
}

export function getTradeNpcOffer(state: GameState): readonly Item[] {
  return tradeOfferSession(state).npcOffer;
}

function mutableTradeOffer(state: GameState): Item[] {
  return tradeOfferSession(state).playerOffer;
}

function mutableTradeNpcOffer(state: GameState): Item[] {
  return tradeOfferSession(state).npcOffer;
}

function quoteOptions(npc: Entity, opts: TradeOptions): EconomyQuoteOptions {
  return {
    floor: opts.floor,
    stockFloor: opts.stockFloor,
    trader: npc,
    tariffMultiplier: opts.tariffMultiplier,
    tags: opts.tags,
    reason: opts.reason,
  };
}

function stockFloorForTrade(state: GameState, opts: TradeOptions): FloorLevel {
  if (opts.stockFloor !== undefined) return opts.stockFloor;
  return typeof opts.floor === 'number' ? opts.floor : state.currentFloor;
}

function decrementSlot(inv: Entity['inventory'], slotIndex: number): void {
  const slot = inv?.[slotIndex];
  if (!slot) return;
  slot.count--;
  if (slot.count <= 0) inv?.splice(slotIndex, 1);
}

function sameItemData(a: unknown, b: unknown): boolean {
  return a === b;
}

function sameOfferItem(slot: Item, item: Pick<Item, 'defId' | 'data'>): boolean {
  return slot.defId === item.defId && sameItemData(slot.data, item.data);
}

function itemCount(inventory: readonly Item[] | undefined, item: Pick<Item, 'defId' | 'data'>): number {
  let total = 0;
  for (const slot of inventory ?? []) {
    if (sameOfferItem(slot, item)) total += Math.max(0, slot.count);
  }
  return total;
}

function offerCount(offer: readonly Item[], item: Pick<Item, 'defId' | 'data'>): number {
  return itemCount(offer, item);
}

function totalOfferCount(offer: readonly Item[]): number {
  let total = 0;
  for (const item of offer) total += Math.max(0, item.count);
  return total;
}

function cloneInventory(inventory: readonly Item[] | undefined): Item[] {
  return (inventory ?? []).map(item => ({ ...item }));
}

function addToOffer(offer: Item[], source: Item): boolean {
  const existing = offer.find(slot => sameOfferItem(slot, source));
  if (existing) {
    existing.count++;
    return true;
  }
  if (offer.length >= TRADE_OFFER_SLOT_CAP) return false;
  const item: Item = { defId: source.defId, count: 1 };
  if (source.data !== undefined) item.data = source.data;
  offer.push(item);
  return true;
}

function removeOfferUnit(offer: Item[], slotIndex: number): Item | undefined {
  const slot = offer[slotIndex];
  if (!slot || slot.count <= 0) return undefined;
  const removed: Item = { defId: slot.defId, count: 1 };
  if (slot.data !== undefined) removed.data = slot.data;
  slot.count--;
  if (slot.count <= 0) offer.splice(slotIndex, 1);
  return removed;
}

function hasInventoryItems(inventory: readonly Item[] | undefined, items: readonly Item[]): boolean {
  for (const item of items) {
    if (item.count <= 0) continue;
    if (itemCount(inventory, item) < item.count) return false;
  }
  return true;
}

function removeInventoryItems(inventory: Item[], items: readonly Item[]): boolean {
  if (!hasInventoryItems(inventory, items)) return false;
  for (const item of items) {
    let remaining = item.count;
    for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
      const slot = inventory[i];
      if (!sameOfferItem(slot, item)) continue;
      const taken = Math.min(remaining, slot.count);
      slot.count -= taken;
      remaining -= taken;
      if (slot.count <= 0) inventory.splice(i, 1);
    }
  }
  return true;
}

function canReceiveAll(receiver: Entity, inventoryAfterOutgoing: readonly Item[], incoming: readonly Item[]): boolean {
  const probe: Entity = { ...receiver, inventory: cloneInventory(inventoryAfterOutgoing) };
  for (const item of incoming) {
    if (item.count <= 0) continue;
    if (!addItem(probe, item.defId, item.count, item.data)) return false;
  }
  return true;
}

function itemListForEvent(items: readonly Item[]): { id: string; count: number }[] {
  return items
    .filter(item => item.count > 0)
    .slice(0, TRADE_OFFER_SLOT_CAP)
    .map(item => ({ id: item.defId, count: item.count }));
}

function publishPlayerBuyEvent(
  state: GameState,
  player: Entity,
  npc: Entity,
  defId: string,
  price: number,
  quote: EconomyQuote,
  zoneId?: number,
  credit?: TradeCreditSummary,
  playerOffer: readonly Item[] = [],
): void {
  const def = ITEMS[defId];
  const govnyak = isGovnyakItem(defId);
  const hasCredit = (credit?.creditCount ?? 0) > 0;
  const fullPrice = credit?.fullPrice ?? price;
  publishEvent(state, {
    type: 'player_handoff_item',
    zoneId,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetId: npc.id,
    targetName: npc.name,
    targetFaction: npc.faction,
    itemId: defId,
    itemName: def?.name ?? defId,
    itemCount: 1,
    itemValue: fullPrice,
    severity: govnyak ? 3 : 1,
    privacy: govnyak ? 'local' : 'private',
    tags: [
      'player',
      'inventory',
      'trade',
      'buy',
      ...(hasCredit ? ['barter'] : []),
      ...(govnyak ? ['govnyak', 'contraband'] : []),
      ...quote.tags,
    ],
    data: {
      price,
      cashPaid: price,
      cashReceived: credit?.changeDue ?? 0,
      netCashPaid: price - (credit?.changeDue ?? 0),
      direction: 'npc_to_player',
      unitPrice: fullPrice,
      totalPrice: fullPrice,
      creditValue: credit?.creditValue ?? 0,
      creditCount: credit?.creditCount ?? 0,
      creditSurplus: credit?.surplus ?? 0,
      unpaidSurplus: Math.max(0, (credit?.surplus ?? 0) - (credit?.changeDue ?? 0)),
      creditItems: itemListForEvent(playerOffer),
      sellerId: npc.id,
      sellerName: npc.name,
      buyerId: player.id,
      buyerName: player.name,
      resourceId: quote.resourceId,
      quoteReason: quote.reason,
      quoteTags: quote.tags,
      rumorIds: govnyak ? ['govnyak_trade'] : [],
    },
  });
}

function tradeCreditUnitQuote(
  state: GameState,
  npc: Entity,
  item: Pick<Item, 'defId'>,
  opts: TradeOptions,
): EconomyQuote {
  return getEconomyQuote(state, item.defId, quoteOptions(npc, opts));
}

function tradeCreditUnitValue(
  state: GameState,
  npc: Entity,
  item: Pick<Item, 'defId'>,
  opts: TradeOptions,
): number {
  return tradeCreditUnitQuote(state, npc, item, opts).sellPrice;
}

function tradeAskUnitValue(
  state: GameState,
  npc: Entity,
  item: Pick<Item, 'defId'>,
  opts: TradeOptions,
): number {
  return getEconomyQuote(state, item.defId, quoteOptions(npc, opts)).buyPrice;
}

function offerValue(
  state: GameState,
  npc: Entity,
  offer: readonly Item[],
  opts: TradeOptions,
): number {
  let total = 0;
  for (const item of offer) {
    if (item.count <= 0) continue;
    total += tradeCreditUnitValue(state, npc, item, opts) * item.count;
  }
  return total;
}

function askValue(
  state: GameState,
  npc: Entity,
  offer: readonly Item[],
  opts: TradeOptions,
): number {
  let total = 0;
  for (const item of offer) {
    if (item.count <= 0) continue;
    total += tradeAskUnitValue(state, npc, item, opts) * item.count;
  }
  return total;
}

function tradeSummaryFromOffers(
  state: GameState,
  npc: Entity,
  playerOffer: readonly Item[],
  npcOffer: readonly Item[],
  opts: TradeOptions,
): TradeCreditSummary {
  const creditValue = offerValue(state, npc, playerOffer, opts);
  const fullPrice = askValue(state, npc, npcOffer, opts);
  const surplus = Math.max(0, creditValue - fullPrice);
  return {
    creditValue,
    creditCount: totalOfferCount(playerOffer),
    fullPrice,
    cashDue: Math.max(0, fullPrice - creditValue),
    changeDue: Math.min(surplus, Math.max(0, npc.money ?? 0)),
    surplus,
    npcOfferValue: fullPrice,
    npcOfferCount: totalOfferCount(npcOffer),
  };
}

export function getTradeDealSummary(
  state: GameState,
  npc: Entity,
  opts: TradeOptions = {},
): TradeCreditSummary {
  return tradeSummaryFromOffers(state, npc, getTradeOffer(state), getTradeNpcOffer(state), opts);
}

export function getTradeCreditSummary(
  state: GameState,
  npc: Entity,
  buyDefId?: string,
  opts: TradeOptions = {},
): TradeCreditSummary {
  const playerOffer = getTradeOffer(state);
  const npcOffer: Item[] = [];
  if (buyDefId) npcOffer.push({ defId: buyDefId, count: 1 });
  return tradeSummaryFromOffers(state, npc, playerOffer, npcOffer, opts);
}

export function addTradeOfferFromSlot(
  state: GameState,
  player: Entity,
  npc: Entity,
  slotIndex: number,
  opts: TradeOptions = {},
): TradeResult {
  const inventory = player.inventory ?? [];
  const source = inventory[slotIndex];
  if (!source || source.count <= 0) return { ok: false, code: 'no_item' };

  const offer = mutableTradeOffer(state);
  const alreadyOffered = offerCount(offer, source);
  const available = itemCount(inventory, source) - alreadyOffered;
  if (available <= 0) return { ok: false, code: 'no_item', defId: source.defId };
  if (!addToOffer(offer, source)) return { ok: false, code: 'offer_full', defId: source.defId };

  const quote = tradeCreditUnitQuote(state, npc, source, opts);
  return {
    ok: true,
    code: 'offer_added',
    defId: source.defId,
    price: quote.sellPrice,
    quote,
    credit: getTradeCreditSummary(state, npc, undefined, opts),
  };
}

export function removeTradeOfferSlot(
  state: GameState,
  npc: Entity,
  slotIndex: number,
  opts: TradeOptions = {},
): TradeResult {
  const removed = removeOfferUnit(mutableTradeOffer(state), slotIndex);
  if (!removed) return { ok: false, code: 'no_item' };
  const quote = tradeCreditUnitQuote(state, npc, removed, opts);
  return {
    ok: true,
    code: 'offer_removed',
    defId: removed.defId,
    price: quote.sellPrice,
    quote,
    credit: getTradeCreditSummary(state, npc, undefined, opts),
  };
}

export function addTradeAskFromSlot(
  state: GameState,
  npc: Entity,
  slotIndex: number,
  opts: TradeOptions = {},
): TradeResult {
  const inventory = npc.inventory ?? [];
  const source = inventory[slotIndex];
  if (!source || source.count <= 0) return { ok: false, code: 'no_item' };

  const offer = mutableTradeNpcOffer(state);
  const alreadyOffered = offerCount(offer, source);
  const available = itemCount(inventory, source) - alreadyOffered;
  if (available <= 0) return { ok: false, code: 'no_item', defId: source.defId };
  if (!addToOffer(offer, source)) return { ok: false, code: 'ask_full', defId: source.defId };

  const quote = tradeCreditUnitQuote(state, npc, source, opts);
  return {
    ok: true,
    code: 'ask_added',
    defId: source.defId,
    price: quote.buyPrice,
    quote,
    credit: getTradeDealSummary(state, npc, opts),
  };
}

export function removeTradeAskSlot(
  state: GameState,
  npc: Entity,
  slotIndex: number,
  opts: TradeOptions = {},
): TradeResult {
  const removed = removeOfferUnit(mutableTradeNpcOffer(state), slotIndex);
  if (!removed) return { ok: false, code: 'no_item' };
  const quote = tradeCreditUnitQuote(state, npc, removed, opts);
  return {
    ok: true,
    code: 'ask_removed',
    defId: removed.defId,
    price: quote.buyPrice,
    quote,
    credit: getTradeDealSummary(state, npc, opts),
  };
}

function applyTradeCreditStockDeltas(
  state: GameState,
  npc: Entity,
  playerOffer: readonly Item[],
  opts: TradeOptions,
): void {
  const floor = stockFloorForTrade(state, opts);
  for (const item of playerOffer) {
    const quote = getEconomyQuote(state, item.defId, quoteOptions(npc, opts));
    if (quote.resourceId) changeResourceStock(state, quote.resourceId, item.count, floor);
  }
}

function applyTradeAskStockDeltas(
  state: GameState,
  npc: Entity,
  npcOffer: readonly Item[],
  opts: TradeOptions,
): void {
  const floor = stockFloorForTrade(state, opts);
  for (const item of npcOffer) {
    const quote = getEconomyQuote(state, item.defId, quoteOptions(npc, opts));
    if (quote.resourceId) changeResourceStock(state, quote.resourceId, -item.count, floor);
  }
}

function combinedQuoteTags(quotes: readonly EconomyQuote[]): string[] {
  const tags = new Set<string>();
  for (const quote of quotes) for (const tag of quote.tags) tags.add(tag);
  return [...tags];
}

function publishTradeDealEvent(
  state: GameState,
  player: Entity,
  npc: Entity,
  price: number,
  summary: TradeCreditSummary,
  playerOffer: readonly Item[],
  npcOffer: readonly Item[],
  quotes: readonly EconomyQuote[],
  zoneId?: number,
): void {
  const firstAsk = npcOffer.find(item => item.count > 0);
  const defId = firstAsk?.defId ?? playerOffer.find(item => item.count > 0)?.defId ?? '';
  const def = defId ? ITEMS[defId] : undefined;
  const hasCredit = summary.creditCount > 0;
  publishEvent(state, {
    type: 'player_handoff_item',
    zoneId,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetId: npc.id,
    targetName: npc.name,
    targetFaction: npc.faction,
    itemId: defId || undefined,
    itemName: def ? def.name : defId || undefined,
    itemCount: totalOfferCount(npcOffer) > 0 ? totalOfferCount(npcOffer) : totalOfferCount(playerOffer),
    itemValue: totalOfferCount(npcOffer) > 0 ? summary.fullPrice : summary.creditValue,
    severity: 1,
    privacy: 'private',
    tags: [
      'player',
      'inventory',
      'trade',
      ...(totalOfferCount(npcOffer) > 0 ? ['buy'] : ['sell']),
      ...(hasCredit ? ['barter'] : []),
      ...(totalOfferCount(npcOffer) > 1 ? ['bundle'] : []),
      ...combinedQuoteTags(quotes),
    ],
    data: {
      price,
      cashPaid: price,
      cashReceived: summary.changeDue,
      netCashPaid: price - summary.changeDue,
      direction: totalOfferCount(npcOffer) > 0 ? 'npc_to_player' : 'player_to_npc',
      creditValue: summary.creditValue,
      creditCount: summary.creditCount,
      creditSurplus: summary.surplus,
      unpaidSurplus: Math.max(0, summary.surplus - summary.changeDue),
      creditItems: itemListForEvent(playerOffer),
      askValue: summary.fullPrice,
      askCount: totalOfferCount(npcOffer),
      unitPrice: summary.fullPrice,
      totalPrice: summary.fullPrice,
      askItems: itemListForEvent(npcOffer),
      sellerId: npc.id,
      sellerName: npc.name,
      buyerId: player.id,
      buyerName: player.name,
      quoteTags: combinedQuoteTags(quotes),
    },
  });
}

export function executeTradeDeal(
  state: GameState,
  player: Entity,
  npc: Entity,
  opts: TradeOptions = {},
): TradeResult {
  const playerOffer = cloneInventory(getTradeOffer(state));
  const npcOffer = cloneInventory(getTradeNpcOffer(state));
  const summary = tradeSummaryFromOffers(state, npc, playerOffer, npcOffer, opts);
  const firstAsk = npcOffer.find(item => item.count > 0);
  const firstOffer = playerOffer.find(item => item.count > 0);
  const firstItem = firstAsk ?? firstOffer;
  if (!firstItem) return { ok: false, code: 'no_item', price: summary.cashDue, credit: summary };
  if ((player.money ?? 0) < summary.cashDue) {
    return { ok: false, code: 'player_no_money', defId: firstItem.defId, price: summary.cashDue, credit: summary };
  }
  if (!hasInventoryItems(player.inventory, playerOffer) || !hasInventoryItems(npc.inventory, npcOffer)) {
    clearTradeOffers(state);
    return { ok: false, code: 'no_item', defId: firstItem.defId, price: summary.cashDue, credit: getTradeDealSummary(state, npc, opts) };
  }

  const playerAfterOutgoing = cloneInventory(player.inventory);
  const npcAfterOutgoing = cloneInventory(npc.inventory);
  if (!removeInventoryItems(playerAfterOutgoing, playerOffer) || !removeInventoryItems(npcAfterOutgoing, npcOffer)) {
    clearTradeOffers(state);
    return { ok: false, code: 'no_item', defId: firstItem.defId, price: summary.cashDue, credit: getTradeDealSummary(state, npc, opts) };
  }
  if (!canReceiveAll(player, playerAfterOutgoing, npcOffer)) {
    return { ok: false, code: 'player_no_space', defId: firstItem.defId, price: summary.cashDue, credit: summary };
  }
  if (!canReceiveAll(npc, npcAfterOutgoing, playerOffer)) {
    return { ok: false, code: 'npc_no_space', defId: firstItem.defId, price: summary.cashDue, credit: summary };
  }

  if (!player.inventory) player.inventory = [];
  if (!npc.inventory) npc.inventory = [];
  removeInventoryItems(player.inventory, playerOffer);
  removeInventoryItems(npc.inventory, npcOffer);
  for (const item of npcOffer) addItem(player, item.defId, item.count, item.data);
  for (const item of playerOffer) addItem(npc, item.defId, item.count, item.data);
  player.money = (player.money ?? 0) - summary.cashDue + summary.changeDue;
  npc.money = (npc.money ?? 0) + summary.cashDue - summary.changeDue;
  applyTradeAskStockDeltas(state, npc, npcOffer, opts);
  applyTradeCreditStockDeltas(state, npc, playerOffer, opts);
  const quotes = [...npcOffer, ...playerOffer].map(item => getEconomyQuote(state, item.defId, quoteOptions(npc, opts)));
  publishTradeDealEvent(state, player, npc, summary.cashDue, summary, playerOffer, npcOffer, quotes, opts.zoneId);
  clearTradeOffers(state);
  primeTradePriceCache(state, [npc.inventory, player.inventory]);
  return { ok: true, code: 'deal_done', defId: firstItem.defId, price: summary.cashDue, quote: quotes[0], credit: summary };
}

export function buyFromNpc(
  state: GameState,
  player: Entity,
  npc: Entity,
  slotIndex: number,
  opts: TradeOptions = {},
): TradeResult {
  const npcInv = npc.inventory ?? [];
  const slot = npcInv[slotIndex];
  if (!slot || slot.count <= 0) return { ok: false, code: 'no_item' };

  const defId = slot.defId;
  const quote = getEconomyQuote(state, defId, quoteOptions(npc, opts));
  const playerOffer = cloneInventory(getTradeOffer(state));
  const credit = getTradeCreditSummary(state, npc, defId, opts);
  const cashDue = credit.cashDue;
  if ((player.money ?? 0) < cashDue) return { ok: false, code: 'player_no_money', defId, price: cashDue, quote, credit };
  if (!hasInventoryItems(player.inventory, playerOffer)) {
    clearTradeOffers(state);
    return { ok: false, code: 'no_item', defId, price: cashDue, quote, credit: getTradeCreditSummary(state, npc, defId, opts) };
  }

  const playerAfterOutgoing = cloneInventory(player.inventory);
  const npcAfterOutgoing = cloneInventory(npc.inventory);
  if (!removeInventoryItems(playerAfterOutgoing, playerOffer)) {
    clearTradeOffers(state);
    return { ok: false, code: 'no_item', defId, price: cashDue, quote, credit: getTradeCreditSummary(state, npc, defId, opts) };
  }
  decrementSlot(npcAfterOutgoing, slotIndex);
  const purchased: Item = { defId, count: 1 };
  if (slot.data !== undefined) purchased.data = slot.data;
  if (!canReceiveAll(player, playerAfterOutgoing, [purchased])) {
    return { ok: false, code: 'player_no_space', defId, price: cashDue, quote, credit };
  }
  if (!canReceiveAll(npc, npcAfterOutgoing, playerOffer)) {
    return { ok: false, code: 'npc_no_space', defId, price: cashDue, quote, credit };
  }

  if (!player.inventory) player.inventory = [];
  if (!npc.inventory) npc.inventory = [];
  removeInventoryItems(player.inventory, playerOffer);
  decrementSlot(npcInv, slotIndex);
  addItem(player, defId, 1, slot.data);
  for (const item of playerOffer) addItem(npc, item.defId, item.count, item.data);
  player.money = (player.money ?? 0) - cashDue + credit.changeDue;
  npc.money = (npc.money ?? 0) + cashDue - credit.changeDue;
  if (quote.resourceId) changeResourceStock(state, quote.resourceId, -1, stockFloorForTrade(state, opts));
  applyTradeCreditStockDeltas(state, npc, playerOffer, opts);
  publishPlayerBuyEvent(state, player, npc, defId, cashDue, quote, opts.zoneId, credit, playerOffer);
  clearTradeOffers(state);
  primeTradePriceCache(state, [npc.inventory, player.inventory]);
  return { ok: true, code: 'bought', defId, price: cashDue, quote, credit };
}

export function sellToNpc(
  state: GameState,
  player: Entity,
  npc: Entity,
  slotIndex: number,
  opts: TradeOptions = {},
): TradeResult {
  if (opts.beforeSell?.({ state, player, npc, slotIndex })) return { ok: true, code: 'handoff' };

  const playerInv = player.inventory ?? [];
  const slot = playerInv[slotIndex];
  if (!slot || slot.count <= 0) return { ok: false, code: 'no_item' };

  const defId = slot.defId;
  const quote = getEconomyQuote(state, defId, quoteOptions(npc, opts));
  const price = quote.sellPrice;
  if ((npc.money ?? 0) < price) return { ok: false, code: 'npc_no_money', defId, price, quote };
  if (!addItem(npc, defId, 1, slot.data)) return { ok: false, code: 'npc_no_space', defId, price, quote };

  npc.money = (npc.money ?? 0) - price;
  player.money = (player.money ?? 0) + price;
  decrementSlot(playerInv, slotIndex);
  if (quote.resourceId) changeResourceStock(state, quote.resourceId, 1, stockFloorForTrade(state, opts));
  recordPlayerItemSale(state, player, npc, defId, 1, price, opts.zoneId, {
    tags: ['sell', ...quote.tags],
    data: {
      resourceId: quote.resourceId,
      quoteReason: quote.reason,
      quoteTags: quote.tags,
    },
  });
  opts.afterSell?.({ state, player, npc, slotIndex, defId, price, quote, zoneId: opts.zoneId });
  return { ok: true, code: 'sold', defId, price, quote };
}
