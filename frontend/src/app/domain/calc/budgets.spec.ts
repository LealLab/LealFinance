import { money } from '../../shared/money/money';
import { Budget } from '../models/budget';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import { budgetProgress, unbudgetedSpend } from './budgets';

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

function tx(overrides: Partial<Transaction>): Transaction {
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
  return { id: 'b', categoryId: 'transport', month: '2026-01', amount: '500', currency: 'BRL', ...overrides };
}

describe('budgetProgress', () => {
  it('reports "under" when spend is comfortably below the budget', () => {
    const transactions = [tx({ categoryId: 'transport', amount: '100' })];
    const progress = budgetProgress(budget(), transactions, categories);

    expect(progress.spent).toEqual(money('100', 'BRL'));
    expect(progress.remaining).toEqual(money('400', 'BRL'));
    expect(progress.state).toBe('under');
  });

  it('rolls up child-category spend into a parent budget', () => {
    const transactions = [
      tx({ categoryId: 'transport', amount: '100' }),
      tx({ categoryId: 'uber', amount: '50' })
    ];
    const progress = budgetProgress(budget(), transactions, categories);

    expect(progress.spent).toEqual(money('150', 'BRL'));
  });

  it('reports "near" from 80% of budget and "over" at or beyond 100%', () => {
    const near = budgetProgress(
      budget(),
      [tx({ categoryId: 'transport', amount: '400' })],
      categories
    );
    const over = budgetProgress(
      budget(),
      [tx({ categoryId: 'transport', amount: '600' })],
      categories
    );

    expect(near.state).toBe('near');
    expect(over.state).toBe('over');
  });

  it('excludes transactions outside the budget month', () => {
    const transactions = [tx({ categoryId: 'transport', amount: '100', date: '2026-02-01' })];
    const progress = budgetProgress(budget(), transactions, categories);

    expect(progress.spent).toEqual(money('0', 'BRL'));
  });

  it('handles a zero budget without dividing by zero', () => {
    const zeroBudget = budget({ amount: '0' });

    const noSpend = budgetProgress(zeroBudget, [], categories);
    expect(noSpend.ratio).toBe(0);
    expect(noSpend.state).toBe('under');

    const anySpend = budgetProgress(
      zeroBudget,
      [tx({ categoryId: 'transport', amount: '1' })],
      categories
    );
    expect(anySpend.ratio).toBe(Infinity);
    expect(anySpend.state).toBe('over');
  });

  it('matches a budget set on a child category exactly, without absorbing sibling spend', () => {
    const uberBudget = budget({ categoryId: 'uber', amount: '50' });
    const transactions = [
      tx({ categoryId: 'uber', amount: '30' }),
      tx({ categoryId: 'transport', amount: '999' })
    ];

    expect(budgetProgress(uberBudget, transactions, categories).spent).toEqual(money('30', 'BRL'));
  });
});

describe('unbudgetedSpend', () => {
  it('lists top-level categories with spend but no budget for the month', () => {
    const transactions = [
      tx({ categoryId: 'transport', amount: '100' }),
      tx({ categoryId: 'food', amount: '80' })
    ];
    const budgets = [budget({ categoryId: 'transport' })];

    const result = unbudgetedSpend(transactions, categories, budgets, '2026-01', 'BRL');

    expect(result).toEqual([{ categoryId: 'food', spent: money('80', 'BRL') }]);
  });

  it('treats a budget on a child category as covering the whole parent group', () => {
    const transactions = [tx({ categoryId: 'uber', amount: '50' })];
    const budgets = [budget({ categoryId: 'transport', month: '2026-01' })];

    expect(unbudgetedSpend(transactions, categories, budgets, '2026-01', 'BRL')).toEqual([]);
  });
});
