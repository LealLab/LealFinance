import { goalProgress, periodsUntil } from './goals';
import { Account } from '../models/account';
import { Goal } from '../models/goal';
import { Transaction } from '../models/transaction';

const account: Account = {
  id: 'goal-account',
  name: 'Viagem',
  type: 'goal',
  currency: 'BRL',
  openingBalance: '1000',
  archived: false,
};
const goal: Goal = {
  id: 'goal',
  accountId: account.id,
  name: 'Viagem',
  targetAmount: '5000',
  currency: 'BRL',
  targetDate: '2026-12-01',
  frequency: 'monthly',
  interval: 1,
  archived: false,
};

describe('goal calculations', () => {
  it('counts monthly periods and derives a required contribution', () => {
    expect(periodsUntil('2026-08-01', '2026-12-01', goal)).toBe(4);
    const progress = goalProgress(goal, account, [], '2026-08-01');
    expect(progress.remaining.amount).toBe('4000.0000');
    expect(progress.requiredContribution?.amount).toBe('1000.0000');
  });

  it('includes transfers and interest in goal balance but not as income', () => {
    const transactions: Transaction[] = [
      {
        id: 'deposit',
        type: 'transfer',
        date: '2026-08-05',
        amount: '250',
        currency: 'BRL',
        accountId: 'checking',
        toAccountId: account.id,
        description: 'Aporte',
      },
      {
        id: 'interest',
        type: 'interest',
        date: '2026-08-06',
        amount: '25',
        currency: 'BRL',
        accountId: account.id,
        description: 'Rendimento',
      },
    ];
    expect(goalProgress(goal, account, transactions, '2026-08-01').current.amount).toBe(
      '1275.0000',
    );
  });
});
