import { Account } from '../models/account';
import { Goal } from '../models/goal';
import { Transaction } from '../models/transaction';
import { addDays, addMonthsClamped, formatIsoDate, parseIsoDate } from './dates';
import { accountBalance } from './balances';
import { compare, Money, money, multiply, subtract } from '../../shared/money/money';

export interface GoalProgress {
  current: Money;
  target: Money;
  remaining: Money;
  ratio: number;
  periodsRemaining?: number;
  requiredContribution?: Money;
  overdue: boolean;
}

function nextPeriod(date: Date, goal: Goal): Date {
  const interval = Math.max(1, goal.interval ?? 1);
  switch (goal.frequency) {
    case 'weekly':
      return addDays(date, interval * 7);
    case 'yearly':
      return addMonthsClamped(date, interval * 12);
    case 'monthly':
    default:
      return addMonthsClamped(date, interval);
  }
}

export function periodsUntil(startDate: string, targetDate: string, goal: Goal): number {
  const target = parseIsoDate(targetDate).getTime();
  let cursor = parseIsoDate(startDate);
  let periods = 0;
  while (cursor.getTime() < target && periods < 2000) {
    cursor = nextPeriod(cursor, goal);
    periods += 1;
  }
  return Math.max(1, periods);
}

export function goalProgress(
  goal: Goal,
  account: Account,
  transactions: readonly Transaction[],
  today = formatIsoDate(new Date()),
): GoalProgress {
  const current = accountBalance(account, transactions);
  const target = money(goal.targetAmount, goal.currency);
  const remaining =
    compare(current, target) >= 0 ? money('0', target.currency) : subtract(target, current);
  const ratio = Number(target.amount) === 0 ? 0 : Number(current.amount) / Number(target.amount);
  const overdue = Boolean(
    goal.targetDate && goal.targetDate < today && compare(current, target) < 0,
  );
  const periodsRemaining =
    goal.targetDate && goal.frequency ? periodsUntil(today, goal.targetDate, goal) : undefined;
  const requiredContribution = periodsRemaining
    ? multiply(remaining, (1 / periodsRemaining).toFixed(6), target.currency)
    : undefined;

  return { current, target, remaining, ratio, periodsRemaining, requiredContribution, overdue };
}
