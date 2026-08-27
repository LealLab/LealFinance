import { Budget } from '../models/budget';
import { BudgetAllocation } from '../models/budget-plan';
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

function budget(overrides: Partial<Budget> = {}): Budget {
  return { id: 'budget', groupId: 'group', month: '2026-01', amount: '0', currency: 'BRL', ...overrides };
}

function allocation(overrides: Partial<BudgetAllocation> = {}): BudgetAllocation {
  return { id: 'alloc', groupId: 'group', percentage: '0', ...overrides };
}

describe('categoryGroupUsage', () => {
  it('counts categories, budgets, and allocations belonging to the group', () => {
    expect(
      categoryGroupUsage(
        'group',
        [category(), category({ id: 'other', groupId: 'other-group' }), category({ id: 'second', groupId: 'group' })],
        [budget(), budget({ id: 'other', groupId: 'other-group' })],
        [allocation()],
      ),
    ).toEqual({ categories: 2, budgets: 1, allocations: 1 });
  });

  it('is all zero when nothing references the group', () => {
    expect(categoryGroupUsage('group', [], [], [])).toEqual({ categories: 0, budgets: 0, allocations: 0 });
  });
});

describe('isCategoryGroupDeletable', () => {
  it('is true when nothing references the group', () => {
    expect(isCategoryGroupDeletable({ categories: 0, budgets: 0, allocations: 0 })).toBe(true);
  });

  it('is false when a category belongs to the group', () => {
    expect(isCategoryGroupDeletable({ categories: 1, budgets: 0, allocations: 0 })).toBe(false);
  });

  it('is false when a budget still targets the group', () => {
    expect(isCategoryGroupDeletable({ categories: 0, budgets: 1, allocations: 0 })).toBe(false);
  });

  it('is false when an allocation still targets the group', () => {
    expect(isCategoryGroupDeletable({ categories: 0, budgets: 0, allocations: 1 })).toBe(false);
  });
});
