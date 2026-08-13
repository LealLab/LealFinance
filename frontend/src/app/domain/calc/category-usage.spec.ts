import { Budget } from '../models/budget';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import { categoryUsage, isCategoryDeletable } from './category-usage';

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat',
    name: 'Categoria',
    kind: 'expense',
    color: '#000',
    icon: 'tag',
    archived: false,
    position: 0,
    ...overrides
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
    ...overrides
  };
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return { id: 'b', categoryId: 'cat', month: '2026-01', amount: '0', currency: 'BRL', ...overrides };
}

describe('categoryUsage', () => {
  it('counts zero references for a wholly unused category', () => {
    const usage = categoryUsage('cat', [category()], [], []);
    expect(usage).toEqual({ transactions: 0, budgets: 0, children: 0 });
  });

  it('counts transactions referencing the category', () => {
    const usage = categoryUsage(
      'cat',
      [category()],
      [tx({ categoryId: 'cat' }), tx({ id: 'tx2', categoryId: 'cat' }), tx({ id: 'tx3', categoryId: 'other' })],
      []
    );
    expect(usage.transactions).toBe(2);
  });

  it('counts budgets referencing the category', () => {
    const usage = categoryUsage(
      'cat',
      [category()],
      [],
      [budget({ categoryId: 'cat' }), budget({ id: 'b2', categoryId: 'other' })]
    );
    expect(usage.budgets).toBe(1);
  });

  it('counts child categories whose parentId points at this category', () => {
    const usage = categoryUsage(
      'cat',
      [category(), category({ id: 'child', parentId: 'cat' }), category({ id: 'unrelated' })],
      [],
      []
    );
    expect(usage.children).toBe(1);
  });
});

describe('isCategoryDeletable', () => {
  it('is true when every count is zero', () => {
    expect(isCategoryDeletable({ transactions: 0, budgets: 0, children: 0 })).toBe(true);
  });

  it('is false when blocked by transactions only', () => {
    expect(isCategoryDeletable({ transactions: 1, budgets: 0, children: 0 })).toBe(false);
  });

  it('is false when blocked by budgets only', () => {
    expect(isCategoryDeletable({ transactions: 0, budgets: 1, children: 0 })).toBe(false);
  });

  it('is false when blocked by children only', () => {
    expect(isCategoryDeletable({ transactions: 0, budgets: 0, children: 1 })).toBe(false);
  });

  it('is false when blocked by a combination of all three', () => {
    expect(isCategoryDeletable({ transactions: 2, budgets: 1, children: 3 })).toBe(false);
  });
});
