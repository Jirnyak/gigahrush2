import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  BANKING_INTEREST_INTERVAL_MINUTES,
  BANKING_LEDGER_CAPACITY,
} from '../src/data/banking';
import {
  accountToCash,
  bankingForSave,
  bankingSummary,
  cashToAccount,
  closeDeposit,
  ensureBankingState,
  normalizeBankingState,
  openDeposit,
  repayLoan,
  takeLoan,
  tickBankingInterest,
} from '../src/systems/banking';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestPlayer } from './helpers';

test('banking state normalizes old saves to an empty account with no debt', () => {
  const normalized = normalizeBankingState(undefined);

  assert.equal(normalized.accountRubles, 0);
  assert.equal(normalized.depositPrincipal, 0);
  assert.equal(normalized.loanPrincipal, 0);
  assert.equal(normalized.loanAccrued, 0);
  assert.equal(normalized.recentLedger.length, 0);
  assert.ok(normalized.creditLimit > 0);
});

test('cash can move to account and back without overdrawing either side', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const player = makeTestPlayer({ money: 100 });

  assert.equal(cashToAccount(state, player, 60, 'atm'), true);
  assert.equal(player.money, 40);
  assert.equal(ensureBankingState(state).accountRubles, 60);
  assert.equal(cashToAccount(state, player, 41, 'atm'), false);
  assert.equal(player.money, 40);
  assert.equal(ensureBankingState(state).accountRubles, 60);

  assert.equal(accountToCash(state, player, 25, 'atm'), true);
  assert.equal(player.money, 65);
  assert.equal(ensureBankingState(state).accountRubles, 35);
  assert.equal(accountToCash(state, player, 36, 'atm'), false);

  const events = getRecentEvents(state, { tags: ['banking', 'account'], limit: 2 });
  assert.equal(events.length, 2);
  assert.equal(events[0].tags.includes('withdraw'), true);
  assert.equal(events[1].tags.includes('deposit'), true);
});

test('loans increase account balance and repayment clears interest before principal', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const banking = ensureBankingState(state);
  banking.accountRubles = 50;
  banking.creditLimit = 200;

  assert.equal(takeLoan(state, 150, 'terminal'), true);
  assert.equal(banking.accountRubles, 200);
  assert.equal(banking.loanPrincipal, 150);
  assert.equal(takeLoan(state, 51, 'terminal'), false);

  banking.loanAccrued = 20;
  assert.equal(repayLoan(state, 60, 'terminal'), true);
  assert.equal(banking.accountRubles, 140);
  assert.equal(banking.loanAccrued, 0);
  assert.equal(banking.loanPrincipal, 110);

  assert.equal(repayLoan(state, 1000, 'terminal'), true);
  assert.equal(banking.accountRubles, 30);
  assert.equal(banking.loanPrincipal, 0);
  assert.equal(banking.loanAccrued, 0);
});

test('deposits accrue bounded interest and close back into account', () => {
  const state = makeGameState({
    clock: { hour: 8, minute: 0, totalMinutes: 0 },
    worldEvents: createWorldEventState(),
  });
  const banking = ensureBankingState(state);
  banking.accountRubles = 1000;

  assert.equal(openDeposit(state, 500), true);
  assert.equal(banking.accountRubles, 500);
  assert.equal(banking.depositPrincipal, 500);
  assert.equal(banking.depositOpenedAt, 0);

  state.clock.totalMinutes = BANKING_INTEREST_INTERVAL_MINUTES;
  assert.equal(tickBankingInterest(state), 5);
  assert.equal(banking.depositPrincipal, 505);
  assert.equal(banking.accountRubles, 500);

  assert.equal(closeDeposit(state), 505);
  assert.equal(banking.depositPrincipal, 0);
  assert.equal(banking.accountRubles, 1005);
});

test('bankingForSave returns bounded plain state', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const player = makeTestPlayer({ money: 1000 });

  for (let i = 0; i < BANKING_LEDGER_CAPACITY + 4; i++) {
    assert.equal(cashToAccount(state, player, 1, `cash_${i}`), true);
  }

  const saved = bankingForSave(state);
  assert.equal(saved.recentLedger.length, BANKING_LEDGER_CAPACITY);
  assert.equal(saved.accountRubles, BANKING_LEDGER_CAPACITY + 4);
  assert.equal(saved.recentLedger[0].source, 'cash_4');
  saved.accountRubles = 0;
  assert.equal(ensureBankingState(state).accountRubles, BANKING_LEDGER_CAPACITY + 4);
});

test('normalizeBankingState handles invalid ledger types gracefully', () => {
  const badState = {
    recentLedger: [
      { id: 1, type: 'invalid_type', amount: 100 },
      { id: 2, type: 'cash_to_account', amount: 50 },
    ],
  };

  const normalized = normalizeBankingState(badState);

  // The invalid entry should be filtered out
  assert.equal(normalized.recentLedger.length, 1);
  assert.equal(normalized.recentLedger[0].type, 'cash_to_account');
  assert.equal(normalized.recentLedger[0].amount, 50);
});

test('tickBankingInterest limits early returns and handles various edge cases', () => {
  const state = makeGameState({
    clock: { hour: 8, minute: 0, totalMinutes: 1000 },
    worldEvents: createWorldEventState(),
  });
  const bank = ensureBankingState(state);

  // Test early return when lastInterestAt > now
  bank.lastInterestAt = 2000;
  assert.equal(tickBankingInterest(state), 0);

  // Test early return when no deposit or loan principal exists
  bank.lastInterestAt = 500;
  assert.equal(tickBankingInterest(state), 0);
  assert.equal(bank.lastInterestAt, 1000); // Updated to now

  // Test interest calculation for loans
  bank.lastInterestAt = 1000 - BANKING_INTEREST_INTERVAL_MINUTES * 2; // 2 periods
  bank.loanPrincipal = 1000;
  bank.loanRate = 0.05; // 5% per period

  assert.equal(tickBankingInterest(state), 100); // 1000 * 0.05 * 2 = 100
  assert.equal(bank.loanAccrued, 100);
  assert.equal(bank.lastInterestAt, 1000);
});

test('bankingSummary returns correct aggregation of banking state', () => {
  const state = makeGameState();
  const bank = ensureBankingState(state);

  bank.accountRubles = 1500;
  bank.depositPrincipal = 500;
  bank.depositRate = 0.02;
  bank.loanPrincipal = 300;
  bank.loanAccrued = 50;
  bank.loanRate = 0.03;
  bank.creditLimit = 1000;
  bank.lastInterestAt = 100;
  bank.ledgerVersion = 5;

  const summary = bankingSummary(state);

  assert.equal(summary.accountRubles, 1500);
  assert.equal(summary.depositPrincipal, 500);
  assert.equal(summary.depositRate, 0.02);
  assert.equal(summary.loanPrincipal, 300);
  assert.equal(summary.loanAccrued, 50);
  assert.equal(summary.debtRubles, 350); // 300 + 50
  assert.equal(summary.loanRate, 0.03);
  assert.equal(summary.creditLimit, 1000);
  assert.equal(summary.availableCredit, 650); // 1000 - 350
  assert.equal(summary.lastInterestAt, 100);
  assert.equal(summary.ledgerVersion, 5);
});

test('bankingForSave returns a distinct clone of the banking state', () => {
  const state = makeGameState();
  const bank = ensureBankingState(state);
  bank.accountRubles = 500;
  bank.loanPrincipal = 100;

  const saved = bankingForSave(state);

  assert.equal(saved.accountRubles, 500);
  assert.equal(saved.loanPrincipal, 100);

  // Modifying the saved state shouldn't affect the active game state
  saved.accountRubles = 0;
  assert.equal(bank.accountRubles, 500);

  // References should be distinct
  assert.notEqual(saved, bank);
  assert.notEqual(saved.recentLedger, bank.recentLedger);
});
