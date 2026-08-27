import { CurrencyConverter } from '../../domain/calc/aggregations';
import { Transaction } from '../../domain/models/transaction';
import { money } from '../../shared/money/money';
import { buildMonthGrid, portfolioDelta } from './calendar-month';

const passthrough: CurrencyConverter = (amount, target) => money(amount.amount, target);

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    type: 'expense',
    date: '2026-03-05',
    amount: '0',
    currency: 'BRL',
    accountId: 'a',
    description: '',
    ...overrides,
  };
}

describe('buildMonthGrid', () => {
  const opening = money('1000', 'BRL');

  it('always produces 42 cells', () => {
    expect(buildMonthGrid('2026-03', [], [], opening, passthrough, 1, '2026-03-15')).toHaveLength(42);
  });

  it('marks leading/trailing days as out of month with a null balance', () => {
    const grid = buildMonthGrid('2026-03', [], [], opening, passthrough, 1, '2026-03-15');
    // 2026-03-01 is a Sunday; with Monday start there are 6 leading cells.
    expect(grid[0].inMonth).toBe(false);
    expect(grid[0].balance).toBeNull();
    expect(grid[6].date).toBe('2026-03-01');
    expect(grid[6].inMonth).toBe(true);
  });

  it('accumulates the running balance forward from the opening', () => {
    const grid = buildMonthGrid(
      '2026-03',
      [
        tx({ type: 'expense', date: '2026-03-05', amount: '100' }),
        tx({ type: 'income', date: '2026-03-10', amount: '50' }),
      ],
      [],
      opening,
      passthrough,
      1,
      '2026-03-15',
    );
    const byDate = new Map(grid.map((d) => [d.date, d]));
    expect(byDate.get('2026-03-04')!.balance).toBe('1000.0000');
    expect(byDate.get('2026-03-05')!.balance).toBe('900.0000');
    expect(byDate.get('2026-03-10')!.balance).toBe('950.0000');
  });

  it('leaves the portfolio balance unchanged for a same-currency transfer', () => {
    const grid = buildMonthGrid(
      '2026-03',
      [tx({ type: 'transfer', date: '2026-03-05', amount: '200', accountId: 'a', toAccountId: 'b' })],
      [],
      opening,
      passthrough,
      1,
      '2026-03-15',
    );
    expect(grid.find((d) => d.date === '2026-03-05')!.balance).toBe('1000.0000');
  });

  it('sets exactly one isToday cell', () => {
    const grid = buildMonthGrid('2026-03', [], [], opening, passthrough, 1, '2026-03-15');
    expect(grid.filter((d) => d.isToday)).toHaveLength(1);
    expect(grid.find((d) => d.isToday)!.date).toBe('2026-03-15');
  });

  it('flags activity dots per kind, including projected', () => {
    const grid = buildMonthGrid(
      '2026-03',
      [
        tx({ type: 'income', date: '2026-03-03', amount: '10' }),
        tx({ type: 'expense', date: '2026-03-03', amount: '5' }),
      ],
      [{ date: '2026-03-20' } as never],
      opening,
      passthrough,
      1,
      '2026-03-15',
    );
    const third = grid.find((d) => d.date === '2026-03-03')!;
    expect(third.hasIncome).toBe(true);
    expect(third.hasExpense).toBe(true);
    expect(grid.find((d) => d.date === '2026-03-20')!.hasProjected).toBe(true);
  });

  it('suppresses balances when there is no opening balance', () => {
    const grid = buildMonthGrid('2026-03', [tx({ amount: '5' })], [], null, passthrough, 1, '2026-03-15');
    expect(grid.every((d) => d.balance === null)).toBe(true);
  });
});

describe('portfolioDelta', () => {
  it('nets a cross-currency transfer to the conversion spread', () => {
    // 100 USD out, 480 BRL in (a real rate would be ~500) - the 20 BRL gap
    // is the spread the portfolio loses.
    const transfer = tx({
      type: 'transfer',
      currency: 'USD',
      amount: '100',
      conversion: { amount: '480', currency: 'BRL', rate: '4.8', source: 'manual' },
    });
    const toBrl: CurrencyConverter = (amount, target) => {
      if (amount.currency === target) return amount;
      if (amount.currency === 'USD' && target === 'BRL') return money(String(Number(amount.amount) * 5), 'BRL');
      throw new Error(`unexpected ${amount.currency}->${target}`);
    };
    expect(portfolioDelta(transfer, toBrl, 'BRL').amount).toBe('-20.0000');
  });
});
