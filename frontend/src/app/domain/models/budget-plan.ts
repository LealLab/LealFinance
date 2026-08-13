/** One reusable percentage allocation for a top-level expense category. */
export interface BudgetAllocation {
  id: string;
  categoryId: string;
  percentage: string;
}

/** Expected income is configured per month and is the base for allocations. */
export interface ExpectedIncome {
  id: string;
  month: string;
  amount: string;
  currency: string;
}
