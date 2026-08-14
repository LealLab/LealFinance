import { money } from '../../shared/money/money';
import { Budget } from '../models/budget';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import { budgetProgress } from './budgets';

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

describe('budgetProgress', () => {
  const categories: Category[] = [
    { id: 'food', name: 'Alimentação', kind: 'expense', color: '#000', icon: 'tag', archived: false, position: 0 }
  ];
  const budget: Budget = { id: 'b1', categoryId: 'food', month: '2026-01', amount: '200', currency: 'BRL' };

  it('uses the recorded conversion amount, not the origin amount, for a foreign-currency expense', () => {
    const transactions = [
      tx({
        categoryId: 'food',
        date: '2026-01-10',
        amount: '50',
        currency: 'USD',
        conversion: { amount: '260', currency: 'BRL', rate: '5.2', source: 'manual' }
      })
    ];

    expect(budgetProgress(budget, transactions, categories).spent).toEqual(money('260', 'BRL'));
  });
});
