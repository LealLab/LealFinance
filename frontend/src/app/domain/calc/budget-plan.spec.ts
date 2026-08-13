import {
  allocationAmount,
  allocationBudgets,
  allocationTotal,
  budgetPercentage,
} from './budget-plan';
import { BudgetAllocation, ExpectedIncome } from '../models/budget-plan';
import { Budget } from '../models/budget';
import { Category } from '../models/category';

const income: ExpectedIncome = { id: 'income', month: '2026-08', amount: '7200', currency: 'BRL' };
const categories: Category[] = [
  {
    id: 'food',
    name: 'Alimentação',
    kind: 'expense',
    color: '#000',
    icon: 'tag',
    archived: false,
    position: 0,
  },
  {
    id: 'health',
    name: 'Saúde',
    kind: 'expense',
    color: '#000',
    icon: 'tag',
    archived: false,
    position: 1,
  },
];

describe('budget plan calculations', () => {
  it('calculates a percentage using money precision', () => {
    expect(allocationAmount(income, '12.5')?.amount).toBe('900.0000');
  });

  it('sums reusable allocations', () => {
    const allocations: BudgetAllocation[] = [
      { id: 'food', categoryId: 'food', percentage: '30' },
      { id: 'health', categoryId: 'health', percentage: '12.5' },
    ];
    expect(allocationTotal(allocations)).toBe(42.5);
  });

  it('calculates a fixed budget percentage from expected income', () => {
    const fixed: Budget = {
      id: 'fixed',
      categoryId: 'food',
      month: '2026-08',
      amount: '500',
      currency: 'BRL',
    };
    expect(budgetPercentage(fixed, income)).toBeCloseTo(6.9444, 3);
  });

  it('does not create a percentage budget where a fixed budget exists', () => {
    const fixed: Budget[] = [
      { id: 'fixed', categoryId: 'food', month: '2026-08', amount: '500', currency: 'BRL' },
    ];
    const allocations: BudgetAllocation[] = [
      { id: 'food', categoryId: 'food', percentage: '30' },
      { id: 'health', categoryId: 'health', percentage: '10' },
    ];
    const result = allocationBudgets(categories, allocations, fixed, income, '2026-08');
    expect(result.map((entry) => entry.categoryId)).toEqual(['health']);
    expect(result[0].budget.amount).toBe('720.0000');
  });
});
