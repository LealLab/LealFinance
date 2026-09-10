import { buildAgenda } from './agenda';
import { Account } from '../models/account';
import { CardInvoice } from '../models/card-invoice';
import { Loan } from '../models/loan';
import { RecurringRule } from '../models/recurring';

const rangeStart = '2026-01-01';
const rangeEnd = '2026-01-31';

const checking: Account = {
  id: 'checking',
  name: 'Checking',
  type: 'checking',
  currency: 'BRL',
  openingBalance: '0',
  archived: false,
};

const card: Account = {
  id: 'card',
  name: 'Card',
  type: 'credit_card',
  currency: 'BRL',
  openingBalance: '0',
  archived: false,
};

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1',
    frequency: 'monthly',
    interval: 1,
    startDate: rangeStart,
    template: {
      type: 'expense',
      amount: '100.00',
      currency: 'BRL',
      accountId: checking.id,
      description: 'Rent',
    },
    ...overrides,
  };
}

function invoice(overrides: Partial<CardInvoice> = {}): CardInvoice {
  return {
    closeDate: '2025-12-20',
    dueDate: '2026-01-10',
    periodStart: '2025-11-21',
    periodEnd: '2025-12-20',
    currency: 'BRL',
    total: '100.00',
    paid: '0.00',
    remaining: '100.00',
    status: 'closed',
    ...overrides,
  };
}

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan-1',
    name: 'Car loan',
    categoryId: 'category-1',
    currency: 'BRL',
    amountBorrowed: '1000.00',
    fees: '0.00',
    interestRate: '0.00',
    ratePeriod: 'monthly',
    installmentCount: 2,
    installmentAmount: '500.00',
    firstPaymentDate: '2026-01-15',
    autoPost: false,
    archived: false,
    installmentsPaid: 0,
    ...overrides,
  };
}

function build(input: Partial<Parameters<typeof buildAgenda>[0]> = {}) {
  return buildAgenda(
    {
      rangeStart,
      rangeEnd,
      accounts: [checking, card],
      recurringRules: [],
      invoices: [],
      loans: [],
      transactions: [],
      ...input,
    },
    'BRL',
  );
}

describe('buildAgenda', () => {
  it('deduplicates a posted recurrence using the recurring-rule/date key', () => {
    const result = build({
      recurringRules: [rule()],
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          date: rangeStart,
          amount: '100.00',
          currency: 'BRL',
          accountId: checking.id,
          description: 'Rent',
          recurringRuleId: 'rule-1',
        },
      ],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].realized).toBe(true);
  });

  it('excludes recurrences charged to a credit card', () => {
    const result = build({
      recurringRules: [
        rule({
          template: { ...rule().template, accountId: card.id },
        }),
      ],
    });

    expect(result.entries).toHaveLength(0);
  });

  it('uses the remaining amount for a partly-paid invoice', () => {
    const result = build({
      invoices: [{ accountId: card.id, invoice: invoice({ paid: '30.00', remaining: '70.00' }) }],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].amount.amount).toBe('70.0000');
    expect(result.entries[0].amount.amount).not.toBe('100.0000');
  });

  it('excludes a paid loan installment using historical transactions', () => {
    const result = build({
      loans: [loan({ installmentsPaid: 0 })],
      transactions: [
        {
          id: 'loan-payment',
          type: 'expense',
          date: '2025-12-15',
          amount: '500.00',
          currency: 'BRL',
          accountId: checking.id,
          description: 'Car loan',
          loanId: 'loan-1',
          installmentNumber: 1,
        },
      ],
    });

    expect(result.entries).toHaveLength(0);
  });

  it('records a loan payment in the window at its actual date and amount without projecting it again', () => {
    const result = build({
      loans: [loan()],
      transactions: [
        {
          id: 'loan-payment',
          type: 'expense',
          date: '2026-01-05',
          amount: '480.00',
          currency: 'BRL',
          accountId: checking.id,
          description: 'Car loan',
          loanId: 'loan-1',
          installmentNumber: 1,
        },
      ],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      date: '2026-01-05',
      source: 'installment',
      realized: true,
    });
    expect(result.realized.outflow.amount).toBe('480.0000');
    expect(result.realized.cashImpact.amount).toBe('-480.0000');
    expect(result.projected.cashImpact.amount).toBe('0.0000');
  });

  it('keeps realized and projected summaries separate', () => {
    const result = build({
      recurringRules: [
        rule({
          id: 'income-rule',
          template: { ...rule().template, type: 'income', amount: '100.00' },
        }),
      ],
      transactions: [
        {
          id: 'income-1',
          type: 'income',
          date: rangeStart,
          amount: '100.00',
          currency: 'BRL',
          accountId: checking.id,
          description: 'Salary',
          recurringRuleId: 'income-rule',
        },
      ],
      invoices: [{ accountId: card.id, invoice: invoice({ remaining: '70.00', paid: '30.00' }) }],
    });

    expect(result.realized.inflow.amount).toBe('100.0000');
    expect(result.realized.cashImpact.amount).toBe('100.0000');
    expect(result.projected.outflow.amount).toBe('70.0000');
    expect(result.projected.cashImpact.amount).toBe('-70.0000');
  });

  it('counts a card-payment transfer as realized cash outflow', () => {
    const result = build({
      invoices: [
        {
          accountId: card.id,
          invoice: invoice({ status: 'paid', paid: '80.00', remaining: '0.00' }),
        },
      ],
      transactions: [
        {
          id: 'card-payment',
          type: 'transfer',
          date: '2026-01-09',
          amount: '80.00',
          currency: 'BRL',
          accountId: checking.id,
          toAccountId: card.id,
          description: 'Card payment',
          cardInvoiceCloseDate: '2025-12-20',
        },
      ],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].direction).toBe('outflow');
    expect(result.realized.cashImpact.amount).toBe('-80.0000');
    expect(result.projected.cashImpact.amount).toBe('0.0000');
  });
});
