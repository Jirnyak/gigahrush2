import { type Entity, type GameState } from '../core/types';
import {
  BANKING_INTEREST_INTERVAL_MINUTES,
  BANKING_LEDGER_CAPACITY,
  BANKING_MAX_INTEREST_PERIODS,
  createBankingState,
  type BankingLedgerEntry,
  type BankingLedgerType,
  type BankingState,
} from '../data/banking';
import { publishEvent } from './events';

type BankingHost = GameState & { banking?: BankingState };

export type { BankingLedgerEntry, BankingLedgerType, BankingState } from '../data/banking';

export interface BankingSummary {
  accountRubles: number;
  depositPrincipal: number;
  depositRate: number;
  loanPrincipal: number;
  loanAccrued: number;
  debtRubles: number;
  loanRate: number;
  creditLimit: number;
  availableCredit: number;
  lastInterestAt: number;
  ledgerVersion: number;
}

function cleanNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanMoney(value: unknown, fallback = 0): number {
  return Math.round(Math.max(0, cleanNumber(value, fallback)) * 100) / 100;
}

function cleanTime(value: unknown, fallback = 0): number {
  return Math.max(0, cleanNumber(value, fallback));
}

function currentMinutes(state: GameState): number {
  return Math.max(0, cleanNumber(state.clock?.totalMinutes, 0));
}

function normalizeLedgerEntry(value: unknown, fallbackId: number): BankingLedgerEntry | null {
  const src = value && typeof value === 'object' ? value as Partial<BankingLedgerEntry> : {};
  const type = src.type;
  if (
    type !== 'cash_to_account'
    && type !== 'account_to_cash'
    && type !== 'open_deposit'
    && type !== 'close_deposit'
    && type !== 'take_loan'
    && type !== 'repay_loan'
    && type !== 'interest'
  ) {
    return null;
  }
  return {
    id: Math.max(1, Math.floor(cleanNumber(src.id, fallbackId))),
    type,
    amount: cleanMoney(src.amount),
    time: cleanTime(src.time),
    totalMinutes: cleanTime(src.totalMinutes),
    accountRubles: cleanMoney(src.accountRubles),
    depositPrincipal: cleanMoney(src.depositPrincipal),
    loanPrincipal: cleanMoney(src.loanPrincipal),
    loanAccrued: cleanMoney(src.loanAccrued),
    source: typeof src.source === 'string' ? src.source.slice(0, 48) : undefined,
  };
}

function isBankingState(value: unknown): value is BankingState {
  const src = value && typeof value === 'object' ? value as Partial<BankingState> : {};
  return Number.isFinite(src.accountRubles)
    && Number.isFinite(src.depositPrincipal)
    && Number.isFinite(src.depositOpenedAt)
    && Number.isFinite(src.depositRate)
    && Number.isFinite(src.loanPrincipal)
    && Number.isFinite(src.loanAccrued)
    && Number.isFinite(src.loanRate)
    && Number.isFinite(src.loanTakenAt)
    && Number.isFinite(src.creditLimit)
    && Number.isFinite(src.lastInterestAt)
    && Number.isFinite(src.ledgerVersion)
    && Array.isArray(src.recentLedger)
    && src.recentLedger.length <= BANKING_LEDGER_CAPACITY;
}

export function normalizeBankingState(value: unknown): BankingState {
  const src = value && typeof value === 'object' ? value as Partial<BankingState> : {};
  const out = createBankingState();
  out.accountRubles = cleanMoney(src.accountRubles);
  out.depositPrincipal = cleanMoney(src.depositPrincipal);
  out.depositOpenedAt = cleanTime(src.depositOpenedAt);
  out.depositRate = Math.max(0, Math.min(1, cleanNumber(src.depositRate, out.depositRate)));
  out.loanPrincipal = cleanMoney(src.loanPrincipal);
  out.loanAccrued = cleanMoney(src.loanAccrued);
  out.loanRate = Math.max(0, Math.min(1, cleanNumber(src.loanRate, out.loanRate)));
  out.loanTakenAt = cleanTime(src.loanTakenAt);
  out.creditLimit = cleanMoney(src.creditLimit, out.creditLimit);
  out.lastInterestAt = cleanTime(src.lastInterestAt);
  out.ledgerVersion = Math.max(1, Math.floor(cleanNumber(src.ledgerVersion, 1)));
  out.recentLedger = Array.isArray(src.recentLedger)
    ? src.recentLedger.map(normalizeLedgerEntry).filter((entry): entry is BankingLedgerEntry => entry !== null).slice(-BANKING_LEDGER_CAPACITY)
    : [];
  return out;
}

export function ensureBankingState(state: GameState): BankingState {
  const host = state as BankingHost;
  if (!isBankingState(host.banking)) host.banking = normalizeBankingState(host.banking);
  return host.banking;
}

export function bankingForSave(state: GameState): BankingState {
  return normalizeBankingState(ensureBankingState(state));
}

function pushLedger(state: GameState, bank: BankingState, type: BankingLedgerType, amount: number, source?: string): void {
  const id = bank.ledgerVersion++;
  bank.recentLedger.push({
    id,
    type,
    amount: cleanMoney(amount),
    time: state.time,
    totalMinutes: currentMinutes(state),
    accountRubles: bank.accountRubles,
    depositPrincipal: bank.depositPrincipal,
    loanPrincipal: bank.loanPrincipal,
    loanAccrued: bank.loanAccrued,
    source,
  });
  if (bank.recentLedger.length > BANKING_LEDGER_CAPACITY) {
    bank.recentLedger.splice(0, bank.recentLedger.length - BANKING_LEDGER_CAPACITY);
  }
}

function publishBankingEvent(
  state: GameState,
  type: BankingLedgerType,
  amount: number,
  bank: BankingState,
  source?: string,
  actor?: Entity,
): void {
  const tags = ['banking', 'account', type];
  if (type === 'cash_to_account' || type === 'open_deposit' || type === 'close_deposit' || source === 'deposit') tags.push('deposit');
  if (type === 'account_to_cash' || type === 'close_deposit') tags.push('withdraw');
  if (type === 'take_loan' || type === 'repay_loan' || source === 'loan') tags.push('loan');
  if (type === 'repay_loan') tags.push('repay');
  publishEvent(state, {
    type: 'player_use_item',
    actorId: actor?.id,
    actorName: actor?.name,
    actorFaction: actor?.faction,
    severity: amount >= 500 ? 3 : 2,
    privacy: 'private',
    tags,
    itemValue: amount,
    data: {
      action: type,
      amount: cleanMoney(amount),
      source,
      accountRubles: bank.accountRubles,
      depositPrincipal: bank.depositPrincipal,
      loanPrincipal: bank.loanPrincipal,
      loanAccrued: bank.loanAccrued,
    },
  });
}

function applyLedger(state: GameState, bank: BankingState, type: BankingLedgerType, amount: number, source?: string, actor?: Entity): void {
  pushLedger(state, bank, type, amount, source);
  if (amount > 0) publishBankingEvent(state, type, amount, bank, source, actor);
}

export function cashToAccount(state: GameState, player: Entity, amount: number, source = 'manual'): boolean {
  const moved = Math.floor(amount);
  if (!Number.isFinite(amount) || moved <= 0 || moved !== amount) return false;
  const cash = cleanMoney(player.money ?? 0);
  if (cash < moved) return false;
  const bank = ensureBankingState(state);
  player.money = cleanMoney(cash - moved);
  bank.accountRubles = cleanMoney(bank.accountRubles + moved);
  applyLedger(state, bank, 'cash_to_account', moved, source, player);
  return true;
}

export function accountToCash(state: GameState, player: Entity, amount: number, source = 'manual'): boolean {
  const moved = Math.floor(amount);
  if (!Number.isFinite(amount) || moved <= 0 || moved !== amount) return false;
  const bank = ensureBankingState(state);
  if (bank.accountRubles < moved) return false;
  bank.accountRubles = cleanMoney(bank.accountRubles - moved);
  player.money = cleanMoney((player.money ?? 0) + moved);
  applyLedger(state, bank, 'account_to_cash', moved, source, player);
  return true;
}

export function openDeposit(state: GameState, amount: number): boolean {
  const moved = Math.floor(amount);
  if (!Number.isFinite(amount) || moved <= 0 || moved !== amount) return false;
  const bank = ensureBankingState(state);
  if (bank.accountRubles < moved) return false;
  bank.accountRubles = cleanMoney(bank.accountRubles - moved);
  if (bank.depositPrincipal <= 0) bank.depositOpenedAt = currentMinutes(state);
  if (bank.lastInterestAt <= 0) bank.lastInterestAt = currentMinutes(state);
  bank.depositPrincipal = cleanMoney(bank.depositPrincipal + moved);
  applyLedger(state, bank, 'open_deposit', moved, 'manual');
  return true;
}

export function closeDeposit(state: GameState): number {
  const bank = ensureBankingState(state);
  const amount = cleanMoney(bank.depositPrincipal);
  if (amount <= 0) return 0;
  bank.depositPrincipal = 0;
  bank.depositOpenedAt = 0;
  bank.accountRubles = cleanMoney(bank.accountRubles + amount);
  applyLedger(state, bank, 'close_deposit', amount, 'manual');
  return amount;
}

export function takeLoan(state: GameState, amount: number, source = 'manual'): boolean {
  const moved = Math.floor(amount);
  if (!Number.isFinite(amount) || moved <= 0 || moved !== amount) return false;
  const bank = ensureBankingState(state);
  const debt = bank.loanPrincipal + bank.loanAccrued;
  if (moved > Math.max(0, bank.creditLimit - debt)) return false;
  if (bank.loanPrincipal <= 0) bank.loanTakenAt = currentMinutes(state);
  if (bank.lastInterestAt <= 0) bank.lastInterestAt = currentMinutes(state);
  bank.loanPrincipal = cleanMoney(bank.loanPrincipal + moved);
  bank.accountRubles = cleanMoney(bank.accountRubles + moved);
  applyLedger(state, bank, 'take_loan', moved, source);
  return true;
}

export function repayLoan(state: GameState, amount: number, source = 'manual'): boolean {
  const moved = Math.floor(amount);
  if (!Number.isFinite(amount) || moved <= 0 || moved !== amount) return false;
  const bank = ensureBankingState(state);
  const debt = cleanMoney(bank.loanPrincipal + bank.loanAccrued);
  const paid = Math.min(moved, debt);
  if (paid <= 0 || bank.accountRubles < paid) return false;

  bank.accountRubles = cleanMoney(bank.accountRubles - paid);
  const interestPaid = Math.min(bank.loanAccrued, paid);
  bank.loanAccrued = cleanMoney(bank.loanAccrued - interestPaid);
  bank.loanPrincipal = cleanMoney(bank.loanPrincipal - (paid - interestPaid));
  if (bank.loanPrincipal <= 0 && bank.loanAccrued <= 0) bank.loanTakenAt = 0;
  applyLedger(state, bank, 'repay_loan', paid, source);
  return true;
}

export function tickBankingInterest(state: GameState): number {
  const bank = ensureBankingState(state);
  const now = currentMinutes(state);
  if (bank.lastInterestAt > now) {
    bank.lastInterestAt = now;
    return 0;
  }
  if (bank.depositPrincipal <= 0 && bank.loanPrincipal <= 0) {
    bank.lastInterestAt = now;
    return 0;
  }
  const elapsed = now - bank.lastInterestAt;
  if (elapsed < BANKING_INTEREST_INTERVAL_MINUTES) return 0;
  const periods = Math.min(BANKING_MAX_INTEREST_PERIODS, Math.floor(elapsed / BANKING_INTEREST_INTERVAL_MINUTES));
  if (periods <= 0) return 0;

  let interest = 0;
  if (bank.depositPrincipal > 0 && bank.depositRate > 0) {
    for (let i = 0; i < periods; i++) {
      const gained = cleanMoney(bank.depositPrincipal * bank.depositRate);
      bank.depositPrincipal = cleanMoney(bank.depositPrincipal + gained);
      interest += gained;
    }
  }
  if (bank.loanPrincipal > 0 && bank.loanRate > 0) {
    const accrued = cleanMoney(bank.loanPrincipal * bank.loanRate * periods);
    bank.loanAccrued = cleanMoney(bank.loanAccrued + accrued);
    interest += accrued;
  }
  bank.lastInterestAt += periods * BANKING_INTEREST_INTERVAL_MINUTES;
  if (interest > 0) applyLedger(state, bank, 'interest', interest, 'interest_tick');
  return cleanMoney(interest);
}

export function bankingSummary(state: GameState): BankingSummary {
  const bank = ensureBankingState(state);
  const debtRubles = cleanMoney(bank.loanPrincipal + bank.loanAccrued);
  return {
    accountRubles: bank.accountRubles,
    depositPrincipal: bank.depositPrincipal,
    depositRate: bank.depositRate,
    loanPrincipal: bank.loanPrincipal,
    loanAccrued: bank.loanAccrued,
    debtRubles,
    loanRate: bank.loanRate,
    creditLimit: bank.creditLimit,
    availableCredit: cleanMoney(Math.max(0, bank.creditLimit - debtRubles)),
    lastInterestAt: bank.lastInterestAt,
    ledgerVersion: bank.ledgerVersion,
  };
}
