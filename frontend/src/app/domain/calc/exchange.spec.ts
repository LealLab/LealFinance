import { money } from '../../shared/money/money';
import { Transaction } from '../models/transaction';
import { CurrencyConverter } from './aggregations';
import { totalConversionFees, transactionsNeedingAttention } from './exchange';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    type: 'transfer',
    date: '2026-01-15',
    amount: '0',
    currency: 'BRL',
    accountId: 'acc-1',
    description: '',
    ...overrides
  };
}

describe('totalConversionFees', () => {
  it('sums zero when nothing has a recorded fee', () => {
    const transactions = [
      tx({ id: '1', conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' } }),
      tx({ id: '2' })
    ];
    expect(totalConversionFees(transactions, 'BRL')).toEqual(money('0', 'BRL'));
  });

  it('sums the fee (in each transaction origin currency) across transactions', () => {
    const transactions = [
      tx({
        id: '1',
        currency: 'USD',
        conversion: { amount: '514.8', currency: 'BRL', fee: '1', rate: '5.2', source: 'manual' }
      }),
      tx({
        id: '2',
        currency: 'USD',
        conversion: { amount: '509.6', currency: 'BRL', fee: '2', rate: '5.2', source: 'manual' }
      })
    ];
    expect(totalConversionFees(transactions, 'USD')).toEqual(money('3', 'USD'));
  });

  it('converts each fee into the target currency before summing', () => {
    const transactions = [
      tx({
        id: '1',
        currency: 'USD',
        conversion: { amount: '514.8', currency: 'BRL', fee: '1', rate: '5.2', source: 'manual' }
      })
    ];
    const convert: CurrencyConverter = () => money('5.2', 'BRL');

    expect(totalConversionFees(transactions, 'BRL', convert)).toEqual(money('5.2', 'BRL'));
  });
});

describe('transactionsNeedingAttention', () => {
  it('returns only the transactions whose conversion used a 1:1 fallback', () => {
    const fallback = tx({
      id: '1',
      currency: 'EUR',
      conversion: { amount: '100', currency: 'BRL', rate: '1', source: 'fallback' }
    });
    const quoted = tx({
      id: '2',
      currency: 'USD',
      conversion: { amount: '520', currency: 'BRL', rate: '5.2', source: 'quote' }
    });
    const plain = tx({ id: '3' });

    expect(transactionsNeedingAttention([fallback, quoted, plain])).toEqual([fallback]);
  });
});
