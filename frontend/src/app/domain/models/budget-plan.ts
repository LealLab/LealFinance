/** One reusable percentage allocation for an expense group. */
export interface BudgetAllocation {
  id: string;
  groupId: string;
  percentage: string;
}

/** Expected income is configured per month and is the base for allocations. */
export interface ExpectedIncome {
  id: string;
  month: string;
  amount: string;
  currency: string;
}
