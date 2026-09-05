import { Loan, LoanRatePeriod } from '../models/loan';
import { Transaction } from '../models/transaction';
import { addMonthsClamped, formatIsoDate, parseIsoDate, todayIso } from './dates';
import { add, Money, money, multiply, subtract, sum } from '../../shared/money/money';

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Finds the non-negative rate whose Price installment matches a contracted value. */
export function interestRateForInstallment(input: {
  amountBorrowed: string;
  fees: string;
  contractedInstallmentAmount: string;
  ratePeriod: LoanRatePeriod;
  installmentCount: number;
}): string | undefined {
  const principal = Number(input.amountBorrowed) + Number(input.fees);
  const target = Number(input.contractedInstallmentAmount);
  const n = input.installmentCount;
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isFinite(target) || target <= 0 || n < 1) {
    return undefined;
  }

  const zeroRateInstallment = principal / n;
  if (target < zeroRateInstallment - 0.00005) return undefined;
  if (Math.abs(target - zeroRateInstallment) <= 0.00005) return '0.0000';

  const paymentAt = (monthlyRate: number): number => {
    return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -n);
  };

  let low = 0;
  let high = 1;
  while (paymentAt(high) < target) high *= 2;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2;
    if (paymentAt(middle) < target) low = middle;
    else high = middle;
  }

  const periodRate = ((low + high) / 2) * (input.ratePeriod === 'monthly' ? 100 : 1200);
  return periodRate.toFixed(4);
}

export type LoanPaymentMode = 'next' | 'last' | 'all';

export interface LoanScheduledInstallment {
  number: number;
  dueDate: string;
  amount: Money;
}

export interface LoanPaymentQuote {
  installments: LoanScheduledInstallment[];
  originalAmount: Money;
  suggestedAmount: Money;
  discount: Money;
}

function paidInstallmentNumbers(loan: Loan, transactions: readonly Transaction[]): Set<number> {
  const paid = new Set(
    transactions
      .filter((transaction) => transaction.loanId === loan.id)
      .map((transaction) => transaction.installmentNumber)
      .filter(
        (number): number is number =>
          number !== undefined && number >= 1 && number <= loan.installmentCount,
      ),
  );

  // Old or not-yet-reloaded rows have no installment number; preserve the former COUNT behavior.
  const targetCount = Math.max(
    paid.size,
    Math.min(loan.installmentsPaid, loan.installmentCount),
  );
  for (let number = 1; paid.size < targetCount && number <= loan.installmentCount; number++) {
    paid.add(number);
  }
  return paid;
}

export function openLoanInstallments(
  loan: Loan,
  transactions: readonly Transaction[] = [],
): LoanScheduledInstallment[] {
  const paid = paidInstallmentNumbers(loan, transactions);
  const installment = money(loan.installmentAmount, loan.currency);
  return Array.from({ length: loan.installmentCount }, (_, index) => index + 1)
    .filter((number) => !paid.has(number))
    .map((number) => ({
      number,
      dueDate: formatIsoDate(addMonthsClamped(parseIsoDate(loan.firstPaymentDate), number - 1)),
      amount: installment,
    }));
}

function discountedInstallment(
  loan: Loan,
  installment: LoanScheduledInstallment,
  paymentDate: string,
): LoanScheduledInstallment {
  const daysEarly = Math.round(
    (parseIsoDate(installment.dueDate).getTime() - parseIsoDate(paymentDate).getTime()) / DAY_MS,
  );
  const monthlyRate = Number(loan.interestRate) / (loan.ratePeriod === 'monthly' ? 100 : 1200);
  if (daysEarly <= 0 || monthlyRate === 0) return installment;
  return {
    ...installment,
    amount: money(
      (Number(installment.amount.amount) / (1 + monthlyRate) ** (daysEarly / 30)).toFixed(4),
      loan.currency,
    ),
  };
}

export function loanPaymentQuote(
  loan: Loan,
  transactions: readonly Transaction[],
  mode: LoanPaymentMode,
  paymentDate: string,
  count = 1,
): LoanPaymentQuote {
  const open = openLoanInstallments(loan, transactions);
  const selected =
    mode === 'all'
      ? open
      : mode === 'last'
        ? // `slice(-0)` returns the whole array (JS normalizes -0 to 0), so a
          // cleared/zeroed count must short-circuit before reaching slice().
          count > 0
          ? open.slice(-count)
          : []
        : open.slice(0, 1);
  const installments = selected.map((item) => discountedInstallment(loan, item, paymentDate));
  const originalAmount = multiply(
    money(loan.installmentAmount, loan.currency),
    String(selected.length),
    loan.currency,
  );
  const suggestedAmount = sum(
    installments.map((item) => item.amount),
    loan.currency,
  );
  return {
    installments,
    originalAmount,
    suggestedAmount,
    discount: subtract(originalAmount, suggestedAmount),
  };
}

export interface LoanScheduleRow {
  number: number;
  dueDate: string;
  amount: Money;
  status: 'open' | 'overdue' | 'paid';
  paidDate?: string;
  paidAmount?: Money;
}

/** The full contract schedule - every installment, paid or not, for the card's expandable table. */
export function loanSchedule(
  loan: Loan,
  transactions: readonly Transaction[] = [],
): LoanScheduleRow[] {
  const paidByNumber = new Map(
    transactions
      .filter((transaction) => transaction.loanId === loan.id)
      .filter(
        (transaction) =>
          transaction.installmentNumber !== undefined &&
          transaction.installmentNumber >= 1 &&
          transaction.installmentNumber <= loan.installmentCount,
      )
      .map((transaction) => [transaction.installmentNumber as number, transaction] as const),
  );
  const paidNumbers = paidInstallmentNumbers(loan, transactions);
  const today = todayIso();
  const installment = money(loan.installmentAmount, loan.currency);

  return Array.from({ length: loan.installmentCount }, (_, index) => index + 1).map((number) => {
    const dueDate = formatIsoDate(addMonthsClamped(parseIsoDate(loan.firstPaymentDate), number - 1));
    const payment = paidByNumber.get(number);
    if (payment) {
      return {
        number,
        dueDate,
        amount: installment,
        status: 'paid',
        paidDate: payment.date,
        paidAmount: money(payment.amount, payment.currency),
      };
    }
    return {
      number,
      dueDate,
      amount: discountedInstallment(loan, { number, dueDate, amount: installment }, today).amount,
      status: paidNumbers.has(number) ? 'paid' : dueDate < today ? 'overdue' : 'open',
    };
  });
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

export function loanProgress(loan: Loan, transactions: readonly Transaction[] = []): LoanProgress {
  const currency = loan.currency;
  const installment = money(loan.installmentAmount, currency);
  const paid = Math.max(
    0,
    Math.min(
      Math.max(loan.installmentsPaid, paidInstallmentNumbers(loan, transactions).size),
      loan.installmentCount,
    ),
  );
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
    nextDueDate: openLoanInstallments(loan, transactions)[0]?.dueDate,
  };
}
