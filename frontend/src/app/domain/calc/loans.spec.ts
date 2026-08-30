import { installmentAmount, loanProgress } from './loans';
import { Loan } from '../models/loan';

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
});
