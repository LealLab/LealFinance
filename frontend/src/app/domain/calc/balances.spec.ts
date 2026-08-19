import { money } from '../../shared/money/money';
import { Account } from '../models/account';
import { Transaction } from '../models/transaction';
import { accountBalance, creditCardSummary } from './balances';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Checking',
    type: 'checking',
    currency: 'BRL',
    openingBalance: '1000',
    archived: false,
    ...overrides
  };
}

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    date: '2026-01-15',
    amount: '0',
    currency: 'BRL',
    accountId: 'acc-1',
    description: '',
    ...overrides
  };
}

describe('accountBalance', () => {
  it('starts from the opening balance with no transactions', () => {
    expect(accountBalance(account(), [])).toEqual(money('1000', 'BRL'));
  });

  it('adds income and subtracts expense', () => {
    const transactions = [
      tx({ id: 't1', type: 'income', amount: '500' }),
      tx({ id: 't2', type: 'expense', amount: '200' })
    ];
    expect(accountBalance(account(), transactions)).toEqual(money('1300', 'BRL'));
  });

  it('ignores transactions posted to a different account', () => {
    const transactions = [tx({ type: 'income', amount: '500', accountId: 'acc-2' })];
    expect(accountBalance(account(), transactions)).toEqual(money('1000', 'BRL'));
  });

  it('moves money between accounts on a transfer without creating income or expense', () => {
    const checking = account({ id: 'checking', openingBalance: '1000' });
    const savings = account({ id: 'savings', openingBalance: '0' });
    const transfer = tx({
      type: 'transfer',
      amount: '300',
      accountId: 'checking',
      toAccountId: 'savings',
      categoryId: undefined
    });

    expect(accountBalance(checking, [transfer])).toEqual(money('700', 'BRL'));
    expect(accountBalance(savings, [transfer])).toEqual(money('300', 'BRL'));
  });

  it('debits the source in its own currency and credits the destination with the converted amount on a cross-currency transfer', () => {
    // Regression test: the incoming leg used to be relabelled with the
    // destination currency instead of converted - a 100 USD transfer would
    // credit BRL 100, not BRL 520.
    const checking = account({ id: 'checking', currency: 'USD', openingBalance: '1000' });
    const savings = account({ id: 'savings', currency: 'BRL', openingBalance: '0' });
    const transfer = tx({
      type: 'transfer',
      amount: '100',
      currency: 'USD',
      accountId: 'checking',
      toAccountId: 'savings',
      categoryId: undefined,
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' }
    });

    expect(accountBalance(checking, [transfer])).toEqual(money('900', 'USD'));
    expect(accountBalance(savings, [transfer])).toEqual(money('520', 'BRL'));
  });

  it('posts the converted amount for a foreign-currency expense', () => {
    const card = account({ id: 'card', currency: 'BRL', openingBalance: '0' });
    const purchase = tx({
      type: 'expense',
      amount: '50',
      currency: 'USD',
      accountId: 'card',
      categoryId: 'cat-1',
      conversion: { amount: '260', currency: 'BRL', rate: '5.2', source: 'manual' }
    });

    expect(accountBalance(card, [purchase])).toEqual(money('-260', 'BRL'));
  });
});

describe('creditCardSummary', () => {
  it('reports zero owed when the balance is zero', () => {
    const card = account({ id: 'card', type: 'credit_card', openingBalance: '0', creditLimit: '2000' });
    const summary = creditCardSummary(card, money('0', 'BRL'));

    expect(summary.owed).toEqual(money('0', 'BRL'));
    expect(summary.available).toEqual(money('2000', 'BRL'));
  });

  it('turns a negative balance into a positive amount owed, and reduces availability', () => {
    const card = account({ id: 'card', type: 'credit_card', openingBalance: '0', creditLimit: '2000' });

    const summary = creditCardSummary(card, money('-350', 'BRL'));

    expect(summary.owed).toEqual(money('350', 'BRL'));
    expect(summary.available).toEqual(money('1650', 'BRL'));
  });

  it('caps owed at zero when the card is in credit (never a negative debt)', () => {
    const card = account({ id: 'card', type: 'credit_card', openingBalance: '0', creditLimit: '2000' });

    expect(creditCardSummary(card, money('50', 'BRL')).owed).toEqual(money('0', 'BRL'));
  });
});
