import { Account } from '../models/account';
import { Transaction } from '../models/transaction';
import { add, isNegative, Money, money, negate, subtract, zero } from '../../shared/money/money';
import { effectiveAmount, sourceAmount } from './conversion';

/**
 * An account's current balance = opening balance + every transaction that
 * touches it. It is deliberately *derived*, not a separately stored field
 * - storing both would let them drift out of sync.
 *
 * The same signed formula applies to every account type, credit cards
 * included: an expense posted to a credit card reduces its balance below
 * zero, exactly like an expense would for a checking account. That
 * negative number *is* what's owed - see `creditCardSummary` below for
 * the debt-oriented presentation built on top of it.
 *
 * Income/interest/expense and a transfer's incoming leg all post
 * `effectiveAmount(tx)` - for a cross-currency transaction (a foreign-
 * currency expense, or a transfer between accounts of different
 * currencies) that's the converted amount, in the account's own currency.
 * A transfer's outgoing leg posts `sourceAmount(tx)` instead, since
 * `tx.currency` already *is* the source account's currency. See
 * domain/calc/conversion.ts. Reading `tx.amount` directly here would
 * either throw (mismatched currency) or, worse, silently relabel the
 * origin amount as if it were the destination currency.
 *
 * ponytail: app/services/accounts.py::account_balances ports this exact
 * formula to a SQL aggregate so most pages can fetch a balance without the
 * full ledger (see AccountRepository.balances()) - reports.ts is the one
 * remaining caller of this function, for its net-worth trend over past
 * months. Delete this once that trend also moves server-side; until then
 * both implementations carry their own matching test coverage for every
 * leg type (income/expense/both transfer legs/cross-currency) - see
 * balances.spec.ts here and test_accounts.py's
 * test_account_balances_* tests - deliberately not a literal shared
 * fixture file, since no such cross-language harness exists elsewhere in
 * this repo.
 */
export function accountBalance(account: Account, transactions: readonly Transaction[]): Money {
  const delta = transactions.reduce((total, tx) => {
    if (tx.accountId === account.id) {
      if (tx.type === 'income' || tx.type === 'interest') {
        // effectiveAmount, not sourceAmount: a foreign-currency income
        // still posts in the account's own currency.
        return add(total, effectiveAmount(tx));
      }
      if (tx.type === 'expense') {
        return subtract(total, effectiveAmount(tx));
      }
      // The outgoing leg of a transfer always debits the source account by
      // its own (origin) amount, in the source account's own currency -
      // `tx.currency` is that currency by the Transaction model's
      // invariant, so `sourceAmount` never needs conversion here. Any
      // fee/conversion only affects what the destination account receives.
      return subtract(total, sourceAmount(tx));
    }
    if (tx.type === 'transfer' && tx.toAccountId === account.id) {
      return add(total, effectiveAmount(tx));
    }
    return total;
  }, zero(account.currency));

  return add(money(account.openingBalance, account.currency), delta);
}

export interface CreditCardSummary {
  /** Amount currently owed - always >= 0, even if the card is in credit. */
  owed: Money;
  limit: Money;
  available: Money;
}

/**
 * Debt-oriented view of a credit_card account's balance: "owed" instead of
 * a raw (negative) balance, plus how much of the credit line remains.
 * Takes the balance directly (rather than transactions to derive it from)
 * since callers increasingly fetch it pre-computed - see
 * AccountRepository.balances().
 */
export function creditCardSummary(account: Account, balance: Money): CreditCardSummary {
  const owed = isNegative(balance) ? negate(balance) : zero(account.currency);
  const limit = money(account.creditLimit ?? '0', account.currency);
  const available = subtract(limit, owed);

  return { owed, limit, available };
}
