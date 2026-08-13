import { Account } from '../models/account';
import { Transaction } from '../models/transaction';
import { add, isNegative, Money, money, negate, subtract, zero } from '../../shared/money/money';

/**
 * An account's current balance = opening balance + every transaction that
 * touches it. It is deliberately *derived*, not a separately stored field
 * — storing both would let them drift out of sync.
 *
 * The same signed formula applies to every account type, credit cards
 * included: an expense posted to a credit card reduces its balance below
 * zero, exactly like an expense would for a checking account. That
 * negative number *is* what's owed — see `creditCardSummary` below for
 * the debt-oriented presentation built on top of it.
 */
export function accountBalance(account: Account, transactions: readonly Transaction[]): Money {
  const delta = transactions.reduce((total, tx) => {
    if (tx.accountId === account.id) {
      if (tx.type === 'income') return add(total, money(tx.amount, account.currency));
      // expense and the outgoing leg of a transfer both reduce the
      // balance of the account they're posted against.
      return subtract(total, money(tx.amount, account.currency));
    }
    if (tx.type === 'transfer' && tx.toAccountId === account.id) {
      return add(total, money(tx.amount, account.currency));
    }
    return total;
  }, zero(account.currency));

  return add(money(account.openingBalance, account.currency), delta);
}

export interface CreditCardSummary {
  /** Amount currently owed — always >= 0, even if the card is in credit. */
  owed: Money;
  limit: Money;
  available: Money;
}

/**
 * Debt-oriented view of a credit_card account's balance: "owed" instead of
 * a raw (negative) balance, plus how much of the credit line remains.
 */
export function creditCardSummary(
  account: Account,
  transactions: readonly Transaction[]
): CreditCardSummary {
  const balance = accountBalance(account, transactions);
  const owed = isNegative(balance) ? negate(balance) : zero(account.currency);
  const limit = money(account.creditLimit ?? '0', account.currency);
  const available = subtract(limit, owed);

  return { owed, limit, available };
}
