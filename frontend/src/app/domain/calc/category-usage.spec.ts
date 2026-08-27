import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import {
  categoryGroupUsage,
  categoryUsage,
  isCategoryDeletable,
  isCategoryGroupDeletable,
} from './category-usage';

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat',
    name: 'Categoria',
    kind: 'expense',
    groupId: 'group',
    color: '#000',
    icon: 'tag',
    position: 0,
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx',
    type: 'expense',
    date: '2026-01-15',
    amount: '0',
    currency: 'BRL',
    accountId: 'acc',
    description: '',
    ...overrides,
  };
}

describe('categoryUsage', () => {
  it('counts zero transactions for a wholly unused category', () => {
    expect(categoryUsage('cat', [])).toEqual({ transactions: 0 });
  });

  it('counts transactions referencing the category', () => {
    const usage = categoryUsage('cat', [
      tx({ categoryId: 'cat' }),
      tx({ id: 'tx2', categoryId: 'cat' }),
      tx({ id: 'tx3', categoryId: 'other' }),
    ]);
    expect(usage).toEqual({ transactions: 2 });
  });
});

describe('isCategoryDeletable', () => {
  it('is true when no transaction references the category', () => {
    expect(isCategoryDeletable({ transactions: 0 })).toBe(true);
  });

  it('is false when a transaction references the category', () => {
    expect(isCategoryDeletable({ transactions: 1 })).toBe(false);
  });
});

describe('categoryGroupUsage', () => {
  it('counts categories in a group', () => {
    expect(
      categoryGroupUsage('group', [
        category(),
        category({ id: 'other', groupId: 'other-group' }),
        category({ id: 'second', groupId: 'group' }),
      ]),
    ).toEqual({ categories: 2 });
  });
});

describe('isCategoryGroupDeletable', () => {
  it('is true when no category belongs to the group', () => {
    expect(isCategoryGroupDeletable({ categories: 0 })).toBe(true);
  });

  it('is false when a category belongs to the group', () => {
    expect(isCategoryGroupDeletable({ categories: 1 })).toBe(false);
  });
});
