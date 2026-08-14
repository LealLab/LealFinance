import { money } from '../../shared/money/money';
import { Account } from '../models/account';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import {
  categoryBreakdown,
  CurrencyConverter,
  groupByMonth,
  netWorth,
  totalsFor
} from './aggregations';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    type: 'expense',
    date: '2026-01-15',
    amount: '0',
    currency: 'BRL',
    accountId: 'acc-1',
    description: '',
    ...overrides
  };
}

describe('totalsFor', () => {
  it('sums income and expense separately and nets them', () => {
    const transactions = [
      tx({ id: '1', type: 'income', amount: '3000' }),
      tx({ id: '2', type: 'expense', amount: '1200' }),
      tx({ id: '3', type: 'expense', amount: '300' })
    ];

    const totals = totalsFor(transactions, 'BRL');

    expect(totals.income).toEqual(money('3000', 'BRL'));
    expect(totals.expense).toEqual(money('1500', 'BRL'));
    expect(totals.net).toEqual(money('1500', 'BRL'));
  });

  it('excludes transfers from both income and expense - they are not earnings or spending', () => {
    const transactions = [
      tx({ id: '1', type: 'income', amount: '1000' }),
      tx({ id: '2', type: 'transfer', amount: '5000', accountId: 'checking', toAccountId: 'savings' })
    ];

    const totals = totalsFor(transactions, 'BRL');

    expect(totals.income).toEqual(money('1000', 'BRL'));
    expect(totals.expense).toEqual(money('0', 'BRL'));
  });

  it('converts each amount through the given converter before summing', () => {
    const transactions = [tx({ id: '1', type: 'income', amount: '100', currency: 'USD' })];
    const convert: CurrencyConverter = () => money('520', 'BRL');

    expect(totalsFor(transactions, 'BRL', convert).income).toEqual(money('520', 'BRL'));
  });
});

describe('categoryBreakdown', () => {
  const categories: Category[] = [
    {
      id: 'transport',
      name: 'Transporte',
      kind: 'expense',
      color: '#000',
      icon: 'tag',
      archived: false,
      position: 0
    },
    {
      id: 'uber',
      name: 'Uber',
      kind: 'expense',
      parentId: 'transport',
      color: '#000',
      icon: 'tag',
      archived: false,
      position: 0
    },
    {
      id: 'food',
      name: 'Alimentação',
      kind: 'expense',
      color: '#000',
      icon: 'tag',
      archived: false,
      position: 1
    }
  ];

  it('rolls up child-category spend into the parent', () => {
    const transactions = [
      tx({ id: '1', categoryId: 'transport', amount: '100' }),
      tx({ id: '2', categoryId: 'uber', amount: '50' }),
      tx({ id: '3', categoryId: 'food', amount: '80' })
    ];

    const breakdown = categoryBreakdown(transactions, categories, 'BRL');

    const transport = breakdown.find((entry) => entry.categoryId === 'transport');
    const food = breakdown.find((entry) => entry.categoryId === 'food');
    expect(transport?.total).toEqual(money('150', 'BRL'));
    expect(food?.total).toEqual(money('80', 'BRL'));
  });

  it('sorts largest total first', () => {
    const transactions = [
      tx({ id: '1', categoryId: 'food', amount: '80' }),
      tx({ id: '2', categoryId: 'transport', amount: '150' })
    ];

    const breakdown = categoryBreakdown(transactions, categories, 'BRL');

    expect(breakdown.map((entry) => entry.categoryId)).toEqual(['transport', 'food']);
  });

  it('excludes income and transfers, and transactions without a category', () => {
    const transactions = [
      tx({ id: '1', type: 'income', categoryId: 'food', amount: '999' }),
      tx({ id: '2', type: 'transfer', categoryId: undefined, amount: '999' }),
      tx({ id: '3', type: 'expense', categoryId: undefined, amount: '999' }),
      tx({ id: '4', type: 'expense', categoryId: 'food', amount: '10' })
    ];

    const breakdown = categoryBreakdown(transactions, categories, 'BRL');

    expect(breakdown).toEqual([{ categoryId: 'food', total: money('10', 'BRL') }]);
  });
});

describe('groupByMonth', () => {
  it('buckets transactions by their YYYY-MM month', () => {
    const transactions = [
      tx({ id: '1', date: '2026-01-05' }),
      tx({ id: '2', date: '2026-01-28' }),
      tx({ id: '3', date: '2026-02-01' })
    ];

    const groups = groupByMonth(transactions);

    expect(groups.get('2026-01')?.map((t) => t.id)).toEqual(['1', '2']);
    expect(groups.get('2026-02')?.map((t) => t.id)).toEqual(['3']);
  });
});

describe('netWorth', () => {
  function account(overrides: Partial<Account> = {}): Account {
    return {
      id: 'acc',
      name: 'Account',
      type: 'checking',
      currency: 'BRL',
      openingBalance: '0',
      archived: false,
      ...overrides
    };
  }

  it('sums balances across non-archived accounts', () => {
    const accounts = [
      account({ id: 'a', openingBalance: '1000' }),
      account({ id: 'b', openingBalance: '500' })
    ];

    expect(netWorth(accounts, [], 'BRL')).toEqual(money('1500', 'BRL'));
  });

  it('excludes archived accounts', () => {
    const accounts = [
      account({ id: 'a', openingBalance: '1000' }),
      account({ id: 'b', openingBalance: '500', archived: true })
    ];

    expect(netWorth(accounts, [], 'BRL')).toEqual(money('1000', 'BRL'));
  });

  it('converts each account balance through the given converter', () => {
    const accounts = [account({ id: 'a', currency: 'USD', openingBalance: '100' })];
    const convert: CurrencyConverter = () => money('520', 'BRL');

    expect(netWorth(accounts, [], 'BRL', convert)).toEqual(money('520', 'BRL'));
  });
});
