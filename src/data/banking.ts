export const BANKING_LEDGER_CAPACITY = 24;
export const BANKING_DEFAULT_DEPOSIT_RATE = 0.01;
export const BANKING_DEFAULT_LOAN_RATE = 0.015;
export const BANKING_DEFAULT_CREDIT_LIMIT = 500;
export const BANKING_INTEREST_INTERVAL_MINUTES = 60;
export const BANKING_MAX_INTEREST_PERIODS = 24;

export type BankingLedgerType =
  | 'cash_to_account'
  | 'account_to_cash'
  | 'open_deposit'
  | 'close_deposit'
  | 'take_loan'
  | 'repay_loan'
  | 'interest';

export interface BankingLedgerEntry {
  id: number;
  type: BankingLedgerType;
  amount: number;
  time: number;
  totalMinutes: number;
  accountRubles: number;
  depositPrincipal: number;
  loanPrincipal: number;
  loanAccrued: number;
  source?: string;
}

export interface BankingState {
  accountRubles: number;
  depositPrincipal: number;
  depositOpenedAt: number;
  depositRate: number;
  loanPrincipal: number;
  loanAccrued: number;
  loanRate: number;
  loanTakenAt: number;
  creditLimit: number;
  lastInterestAt: number;
  ledgerVersion: number;
  recentLedger: BankingLedgerEntry[];
}

export function createBankingState(): BankingState {
  return {
    accountRubles: 0,
    depositPrincipal: 0,
    depositOpenedAt: 0,
    depositRate: BANKING_DEFAULT_DEPOSIT_RATE,
    loanPrincipal: 0,
    loanAccrued: 0,
    loanRate: BANKING_DEFAULT_LOAN_RATE,
    loanTakenAt: 0,
    creditLimit: BANKING_DEFAULT_CREDIT_LIMIT,
    lastInterestAt: 0,
    ledgerVersion: 1,
    recentLedger: [],
  };
}
