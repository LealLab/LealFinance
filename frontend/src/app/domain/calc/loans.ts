import { Loan, LoanRatePeriod } from '../models/loan';
import { addMonthsClamped, formatIsoDate, parseIsoDate } from './dates';
import { add, Money, money, multiply, subtract } from '../../shared/money/money';

/**
 * The Python twin of this amortization lives in app/services/loans.py
 * (`compute_installment_amount`) and is the authoritative one - what the
 * backend stores on `Loan.installmentAmount`. This function exists for the
 * loan form's live "your monthly payment will be..." preview before the
 * loan is saved. Both are covered by specs that feed the same fixture
 * inputs, the way domain/calc/recurrence.ts is kept in lockstep with
 * app/services/recurrence.py.
 *
 * The math runs in float64 rather than the bigint money helpers (which
 * have no power or division): amortization needs `(1 + i) ** n`, and
 * float64 is exact well past 4 decimal places for any realistic loan.
 * This is the display boundary, like `toNumber` in money.ts - the stored
 * value still comes from the backend.
 */
export function installmentAmount(input: {
  amountBorrowed: string;
  fees: string;
  interestRate: string;
  ratePeriod: LoanRatePeriod;
  installmentCount: number;
}): string {
  const principal = Number(input.amountBorrowed) + Number(input.fees);
  const n = input.installmentCount;
  const monthlyRate = Number(input.interestRate) / (input.ratePeriod === 'monthly' ? 100 : 1200);

  if (!Number.isFinite(principal) || n < 1) return '0.0000';

  const raw =
    monthlyRate === 0
      ? principal / n
      : (principal * monthlyRate * (1 + monthlyRate) ** n) / ((1 + monthlyRate) ** n - 1);

  return raw.toFixed(4);
}

export interface LoanProgress {
  paid: number;
  total: number;
  ratio: number;
  paidAmount: Money;
  totalPayable: Money;
  remaining: Money;
  totalInterest: Money;
  /** ISO date of the next unpaid installment, or undefined once every installment is paid. */
  nextDueDate?: string;
}

export function loanProgress(loan: Loan): LoanProgress {
  const currency = loan.currency;
  const installment = money(loan.installmentAmount, currency);
  const paid = Math.max(0, Math.min(loan.installmentsPaid, loan.installmentCount));
  const total = loan.installmentCount;

  const paidAmount = multiply(installment, String(paid), currency);
  const totalPayable = multiply(installment, String(total), currency);
  const financed = add(money(loan.amountBorrowed, currency), money(loan.fees, currency));

  return {
    paid,
    total,
    ratio: total === 0 ? 0 : paid / total,
    paidAmount,
    totalPayable,
    remaining: subtract(totalPayable, paidAmount),
    totalInterest: subtract(totalPayable, financed),
    nextDueDate:
      paid >= total
        ? undefined
        : formatIsoDate(addMonthsClamped(parseIsoDate(loan.firstPaymentDate), paid)),
  };
}
