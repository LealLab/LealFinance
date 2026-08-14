import { money } from '../../shared/money/money';
import { Transaction } from '../models/transaction';
import { conversionFee, effectiveAmount, needsRateAttention, sourceAmount } from './conversion';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    date: '2026-01-15',
    amount: '0',
    currency: 'BRL',
    accountId: 'acc-1',
    description: '',
    ...overrides
  };
}

describe('effectiveAmount', () => {
  it('returns the plain amount/currency for a same-currency transaction', () => {
    expect(effectiveAmount(tx({ amount: '100', currency: 'BRL' }))).toEqual(money('100', 'BRL'));
  });

  it('returns the conversion amount/currency for a cross-currency transfer', () => {
    const transfer = tx({
      type: 'transfer',
      amount: '100',
      currency: 'USD',
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' }
    });
    expect(effectiveAmount(transfer)).toEqual(money('520', 'BRL'));
  });

  it('returns the conversion amount/currency for a foreign-currency expense', () => {
    const expense = tx({
      type: 'expense',
      amount: '50',
      currency: 'USD',
      conversion: { amount: '260', currency: 'BRL', rate: '5.2', source: 'manual' }
    });
    expect(effectiveAmount(expense)).toEqual(money('260', 'BRL'));
  });
});

describe('sourceAmount', () => {
  it('always returns the origin amount/currency, ignoring any conversion', () => {
    const transfer = tx({
      type: 'transfer',
      amount: '100',
      currency: 'USD',
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' }
    });
    expect(sourceAmount(transfer)).toEqual(money('100', 'USD'));
  });
});

describe('conversionFee', () => {
  it('returns null when there is no conversion', () => {
    expect(conversionFee(tx({ amount: '100', currency: 'BRL' }))).toBeNull();
  });

  it('returns null when the conversion has no fee', () => {
    const transfer = tx({
      type: 'transfer',
      amount: '100',
      currency: 'USD',
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' }
    });
    expect(conversionFee(transfer)).toBeNull();
  });

  it('returns the fee in the origin currency', () => {
    const transfer = tx({
      type: 'transfer',
      amount: '100',
      currency: 'USD',
      conversion: { amount: '514.8', currency: 'BRL', fee: '1', rate: '5.2', source: 'manual' }
    });
    expect(conversionFee(transfer)).toEqual(money('1', 'USD'));
  });
});

describe('needsRateAttention', () => {
  it('is false when there is no conversion', () => {
    expect(needsRateAttention(tx({ amount: '100', currency: 'BRL' }))).toBe(false);
  });

  it('is false when the conversion came from a manual rate or a live quote', () => {
    const manual = tx({
      type: 'transfer',
      currency: 'USD',
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'manual' }
    });
    const quoted = tx({
      type: 'transfer',
      currency: 'USD',
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' }
    });
    expect(needsRateAttention(manual)).toBe(false);
    expect(needsRateAttention(quoted)).toBe(false);
  });

  it('is true when the conversion used a 1:1 fallback rate', () => {
    const fallback = tx({
      type: 'transfer',
      currency: 'USD',
      conversion: { amount: '100', currency: 'EUR', rate: '1', source: 'fallback' }
    });
    expect(needsRateAttention(fallback)).toBe(true);
  });
});
