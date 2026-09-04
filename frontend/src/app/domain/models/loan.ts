/** How a loan's `interestRate` is expressed. `monthly` uses it directly as
 * the monthly rate (the Brazilian convention); `annual` is a nominal rate
 * divided by 12. */
export type LoanRatePeriod = 'annual' | 'monthly';

/**
 * A loan the user is repaying. Standalone metadata - it never sits on an
 * Account and never shows up in a balance or net worth. Payments are
 * ordinary expense transactions carrying `Transaction.loanId` and the
 * loan's own `categoryId`, so the debt appears in the user's spending and
 * budgets under that category.
 *
 * `installmentAmount` is resolved server-side from `contractedInstallmentAmount`
 * when present, otherwise from the amortization inputs. `installmentsPaid` is
 * COUNT(transactions with this loanId), also computed by the backend.
 */
export interface Loan {
  id: string;
  name: string;
  categoryId: string;
  currency: string;
  amountBorrowed: string;
  fees: string;
  interestRate: string;
  ratePeriod: LoanRatePeriod;
  installmentCount: number;
  /** Optional contract value that overrides the installment calculated from the interest rate. */
  contractedInstallmentAmount?: string;
  installmentAmount: string;
  firstPaymentDate: string;
  autoPost: boolean;
  paymentAccountId?: string;
  notes?: string;
  archived: boolean;
  installmentsPaid: number;
}
