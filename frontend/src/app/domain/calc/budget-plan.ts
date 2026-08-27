import { Budget } from '../models/budget';
import { BudgetAllocation, ExpectedIncome } from '../models/budget-plan';
import { Category } from '../models/category';
import { money, multiply, Money, ratio, sum } from '../../shared/money/money';

export interface AllocationBudget {
  groupId: string;
  percentage: string;
  budget: Budget;
}

export function allocationAmount(
  income: ExpectedIncome | undefined,
  percentage: string,
): Money | undefined {
  if (!income) return undefined;
  return multiply(
    money(income.amount, income.currency),
    (Number(percentage) / 100).toFixed(6),
    income.currency,
  );
}

export function allocationTotal(allocations: readonly BudgetAllocation[]): number {
  return allocations.reduce((total, allocation) => total + Number(allocation.percentage), 0);
}

/** Percentage represented by a fixed budget relative to the month's expected income. */
export function budgetPercentage(budget: Budget, income: ExpectedIncome | undefined): number {
  if (!income || budget.currency !== income.currency || Number(income.amount) === 0) return 0;
  return ratio(money(budget.amount, budget.currency), money(income.amount, income.currency)) * 100;
}

export function allocationBudgets(
  categories: readonly Category[],
  allocations: readonly BudgetAllocation[],
  fixedBudgets: readonly Budget[],
  income: ExpectedIncome | undefined,
  month: string,
): AllocationBudget[] {
  const fixedIds = new Set(
    fixedBudgets.filter((budget) => budget.month === month).map((budget) => budget.groupId),
  );
  return allocations
    .filter(
      (allocation) => !fixedIds.has(allocation.groupId) && Number(allocation.percentage) > 0,
    )
    .map((allocation) => {
      const amount = allocationAmount(income, allocation.percentage);
      if (!amount) return undefined;
      return {
        groupId: allocation.groupId,
        percentage: allocation.percentage,
        budget: {
          id: `allocation-${allocation.groupId}`,
          groupId: allocation.groupId,
          month,
          amount: amount.amount,
          currency: amount.currency,
        },
      };
    })
    .filter((entry): entry is AllocationBudget => Boolean(entry));
}

export function plannerTotal(
  allocations: readonly BudgetAllocation[],
  income: ExpectedIncome | undefined,
  categories: readonly Category[],
  fixedBudgets: readonly Budget[],
  month: string,
): Money | undefined {
  const budgets = allocationBudgets(categories, allocations, fixedBudgets, income, month);
  if (!budgets.length) return income ? money('0', income.currency) : undefined;
  return sum(
    budgets.map((entry) => money(entry.budget.amount, entry.budget.currency)),
    budgets[0].budget.currency,
  );
}
