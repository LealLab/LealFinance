import {
  installmentAmount,
  interestRateForInstallment,
  loanPaymentQuote,
  loanProgress,
  loanSchedule,
  openLoanInstallments,
} from './loans';
import { addDays, formatIsoDate, parseIsoDate, todayIso } from './dates';
import { Loan } from '../models/loan';
import { Transaction } from '../models/transaction';

describe('installmentAmount', () => {
  // Same fixtures as the Python twin in backend/tests/test_loans.py, so the
  // two amortization implementations are provably in lockstep.
  it('matches the amortization formula for an interest-bearing loan', () => {
    expect(
      installmentAmount({
        amountBorrowed: '40000',
        fees: '0',
        interestRate: '1.2',
        ratePeriod: 'monthly',
        installmentCount: 48,
      }),
    ).toBe('1101.1021');
  });

  it('is straight-line division when the rate is zero (fees financed in)', () => {
    expect(
      installmentAmount({
        amountBorrowed: '1200',
        fees: '300',
        interestRate: '0',
        ratePeriod: 'annual',
        installmentCount: 12,
      }),
    ).toBe('125.0000');
  });

  it('treats an annual rate as nominal (divided by 12)', () => {
    const monthly = installmentAmount({
      amountBorrowed: '10000',
      fees: '0',
      interestRate: '1',
      ratePeriod: 'monthly',
      installmentCount: 24,
    });
    const annual = installmentAmount({
      amountBorrowed: '10000',
      fees: '0',
      interestRate: '12',
      ratePeriod: 'annual',
      installmentCount: 24,
    });
    expect(monthly).toBe(annual);
  });
});

describe('interestRateForInstallment', () => {
  it('finds the monthly and nominal annual rates implied by the contract', () => {
    const input = {
      amountBorrowed: '40000',
      fees: '0',
      contractedInstallmentAmount: '1101.1021',
      installmentCount: 48,
    };
    expect(interestRateForInstallment({ ...input, ratePeriod: 'monthly' })).toBe('1.2000');
    expect(interestRateForInstallment({ ...input, ratePeriod: 'annual' })).toBe('14.4000');
  });

  it('rejects a contract value that would require negative interest', () => {
    expect(
      interestRateForInstallment({
        amountBorrowed: '1200',
        fees: '0',
        contractedInstallmentAmount: '99',
        ratePeriod: 'monthly',
        installmentCount: 12,
      }),
    ).toBeUndefined();
  });
});

describe('loanProgress', () => {
  const base: Loan = {
    id: 'loan-1',
    name: 'Car',
    categoryId: 'cat-1',
    currency: 'BRL',
    amountBorrowed: '900',
    fees: '100',
    interestRate: '0',
    ratePeriod: 'annual',
    installmentCount: 10,
    installmentAmount: '100.0000',
    firstPaymentDate: '2026-01-15',
    autoPost: false,
    archived: false,
    installmentsPaid: 3,
  };

  it('derives paid/remaining/interest from the installment and the count', () => {
    const p = loanProgress(base);
    expect(p.paid).toBe(3);
    expect(p.total).toBe(10);
    expect(p.ratio).toBeCloseTo(0.3);
    expect(p.paidAmount.amount).toBe('300.0000');
    expect(p.totalPayable.amount).toBe('1000.0000');
    expect(p.remaining.amount).toBe('700.0000');
    expect(p.totalInterest.amount).toBe('0.0000');
    expect(p.nextDueDate).toBe('2026-04-15');
  });

  it('reports totalInterest above zero for an interest-bearing loan', () => {
    const p = loanProgress({ ...base, installmentAmount: '110.0000', interestRate: '2' });
    // 10 * 110 = 1100 payable, financed 1000 -> 100 interest.
    expect(p.totalInterest.amount).toBe('100.0000');
  });

  it('has no next due date once every installment is paid', () => {
    const p = loanProgress({ ...base, installmentsPaid: 10 });
    expect(p.nextDueDate).toBeUndefined();
    expect(p.ratio).toBe(1);
  });

  it('keeps the first installment due when the last one was paid early', () => {
    const lastPayment: Transaction = {
      id: 'tx-last',
      type: 'expense',
      date: '2025-12-01',
      amount: '90',
      currency: 'BRL',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      description: 'Last installment',
      loanId: base.id,
      installmentGroupId: base.id,
      installmentNumber: 10,
      installmentCount: 10,
    };
    expect(loanProgress({ ...base, installmentsPaid: 1 }, [lastPayment]).nextDueDate).toBe(
      '2026-01-15',
    );
  });
});

describe('loanPaymentQuote', () => {
  const loan: Loan = {
    id: 'loan-quote',
    name: 'Car',
    categoryId: 'cat-1',
    currency: 'BRL',
    amountBorrowed: '1000',
    fees: '0',
    interestRate: '1',
    ratePeriod: 'monthly',
    installmentCount: 10,
    installmentAmount: '110.0000',
    firstPaymentDate: '2026-01-15',
    autoPost: false,
    archived: false,
    installmentsPaid: 0,
  };

  it('selects the last N open installments and discounts each one by days early', () => {
    const quote = loanPaymentQuote(loan, [], 'last', '2026-01-15', 2);
    expect(quote.installments.map((item) => item.number)).toEqual([9, 10]);
    for (const installment of quote.installments) {
      const days =
        (Date.parse(`${installment.dueDate}T00:00:00Z`) - Date.parse('2026-01-15T00:00:00Z')) /
        86_400_000;
      expect(installment.amount.amount).toBe(
        (110 / 1.01 ** (days / 30)).toFixed(4),
      );
    }
    expect(Number(quote.discount.amount)).toBeGreaterThan(0);
  });

  it('excludes installment numbers already paid', () => {
    const paid: Transaction = {
      id: 'tx-10',
      type: 'expense',
      date: '2025-12-01',
      amount: '100',
      currency: 'BRL',
      accountId: 'acc-1',
      description: 'Paid last',
      loanId: loan.id,
      installmentNumber: 10,
      installmentCount: 10,
    };
    expect(openLoanInstallments({ ...loan, installmentsPaid: 1 }, [paid]).map((item) => item.number))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(
      loanPaymentQuote({ ...loan, installmentsPaid: 1 }, [paid], 'last', '2026-01-15', 2)
        .installments.map((item) => item.number),
    ).toEqual([8, 9]);
  });

  it('selects no installments for "last" when count is 0, not the whole array', () => {
    // `[1,2,3].slice(-0)` returns the whole array - JS normalizes -0 to 0 -
    // so a cleared count field must short-circuit before reaching slice().
    const quote = loanPaymentQuote(loan, [], 'last', '2026-01-15', 0);
    expect(quote.installments).toEqual([]);
    expect(quote.suggestedAmount.amount).toBe('0.0000');
  });
});

describe('loanSchedule', () => {
  it('marks the final installments paid in advance and leaves the rest open or overdue', () => {
    // First installment due yesterday (unpaid -> overdue); the last two were
    // advanced today, ahead of their real due dates.
    const yesterday = formatIsoDate(addDays(parseIsoDate(todayIso()), -1));
    const loan: Loan = {
      id: 'loan-schedule',
      name: 'Car',
      categoryId: 'cat-1',
      currency: 'BRL',
      amountBorrowed: '300',
      fees: '0',
      interestRate: '0',
      ratePeriod: 'monthly',
      installmentCount: 3,
      installmentAmount: '100.0000',
      firstPaymentDate: yesterday,
      autoPost: false,
      archived: false,
      installmentsPaid: 0,
    };
    const advanced: Transaction[] = [2, 3].map((number) => ({
      id: `tx-${number}`,
      type: 'expense',
      date: todayIso(),
      amount: '95.0000',
      currency: 'BRL',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      description: `Car ${number}/3`,
      loanId: loan.id,
      installmentNumber: number,
      installmentCount: 3,
    }));

    const rows = loanSchedule(loan, advanced);
    expect(rows.map((row) => row.status)).toEqual(['overdue', 'paid', 'paid']);
    expect(rows[1].paidDate).toBe(todayIso());
    expect(rows[1].paidAmount?.amount).toBe('95.0000');
    expect(rows[0].paidAmount).toBeUndefined();
  });

  it('is empty for a fully open loan with none of it due yet', () => {
    const loan: Loan = {
      id: 'loan-schedule-2',
      name: 'Car',
      categoryId: 'cat-1',
      currency: 'BRL',
      amountBorrowed: '100',
      fees: '0',
      interestRate: '0',
      ratePeriod: 'monthly',
      installmentCount: 1,
      installmentAmount: '100.0000',
      firstPaymentDate: '2090-01-15',
      autoPost: false,
      archived: false,
      installmentsPaid: 0,
    };
    expect(loanSchedule(loan, []).map((row) => row.status)).toEqual(['open']);
  });

  it('discounts an open installment as of today but keeps an overdue one at the contractual amount', () => {
    // Installment 1 is due yesterday (overdue, no automatic penalty);
    // installment 2 is due about a month out (open, discounted for today).
    const yesterday = formatIsoDate(addDays(parseIsoDate(todayIso()), -1));
    const loan: Loan = {
      id: 'loan-schedule-3',
      name: 'Car',
      categoryId: 'cat-1',
      currency: 'BRL',
      amountBorrowed: '1000',
      fees: '0',
      interestRate: '1',
      ratePeriod: 'monthly',
      installmentCount: 2,
      installmentAmount: '110.0000',
      firstPaymentDate: yesterday,
      autoPost: false,
      archived: false,
      installmentsPaid: 0,
    };

    const rows = loanSchedule(loan, []);
    expect(rows[0].status).toBe('overdue');
    expect(rows[0].amount.amount).toBe('110.0000');
    expect(rows[1].status).toBe('open');
    expect(Number(rows[1].amount.amount)).toBeLessThan(110);
  });
});
