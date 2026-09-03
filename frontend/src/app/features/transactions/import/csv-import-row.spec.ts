import { ImportRow } from '../../../data/transaction.repository';
import {
  compareRows,
  CsvImportRow,
  isImportable,
  isReviewable,
  pendingCategoryCreations,
  reviewedCount,
  toImportRows
} from './csv-import-row';

const cleanRow: ImportRow = {
  index: 0,
  date: '2026-01-15',
  description: 'Coffee',
  type: 'expense',
  amount: '5.00',
  categoryId: 'c1',
  categoryName: 'Groceries',
  duplicate: false
};

describe('toImportRows', () => {
  it('starts every row unreviewed', () => {
    expect(toImportRows([cleanRow])[0].reviewed).toBe(false);
  });

  it('excludes duplicate rows by default so re-importing a file is a no-op unless overridden', () => {
    const [row] = toImportRows([{ ...cleanRow, duplicate: true }]);
    expect(row.excluded).toBe(true);
  });

  it('leaves non-duplicate rows included by default', () => {
    expect(toImportRows([cleanRow])[0].excluded).toBe(false);
  });
});

describe('isReviewable', () => {
  it('is false for a row with a parse error', () => {
    const [row] = toImportRows([{ ...cleanRow, error: 'import.row.invalid_date' }]);
    expect(isReviewable(row)).toBe(false);
  });

  it('is false for a row missing a category', () => {
    const [row] = toImportRows([{ ...cleanRow, categoryId: undefined }]);
    expect(isReviewable(row)).toBe(false);
  });

  it('is true for a clean, categorized row', () => {
    expect(isReviewable(toImportRows([cleanRow])[0])).toBe(true);
  });

  it('requires a counterparty instead of a category for transfer rows', () => {
    const transfer = toImportRows([
      { ...cleanRow, type: 'transfer', categoryId: undefined, categoryName: undefined }
    ])[0];
    expect(isReviewable(transfer)).toBe(false);
    expect(isReviewable({ ...transfer, counterpartyAccountId: 'account-2' })).toBe(true);
  });
});

describe('isImportable', () => {
  it('is false until the row is marked reviewed', () => {
    const [row] = toImportRows([cleanRow]);
    expect(isImportable(row)).toBe(false);
  });

  it('is true once reviewed', () => {
    const [row] = toImportRows([cleanRow]);
    expect(isImportable({ ...row, reviewed: true })).toBe(true);
  });

  it('is false when excluded, even if reviewed', () => {
    const [row] = toImportRows([cleanRow]);
    expect(isImportable({ ...row, reviewed: true, excluded: true })).toBe(false);
  });

  it('is false when reviewed but no longer reviewable (e.g. category cleared after ticking)', () => {
    const [row] = toImportRows([cleanRow]);
    expect(isImportable({ ...row, reviewed: true, categoryId: undefined })).toBe(false);
  });
});

describe('reviewedCount', () => {
  it('counts only importable rows', () => {
    const rows = toImportRows([cleanRow, { ...cleanRow, index: 1, duplicate: true }]).map(
      (row, i) => (i === 0 ? { ...row, reviewed: true } : row)
    );
    expect(reviewedCount(rows)).toBe(1);
  });
});

describe('pendingCategoryCreations', () => {
  const proposalRow = (over: Partial<CsvImportRow>): CsvImportRow => ({
    ...toImportRows([{ ...cleanRow, categoryId: undefined, categoryName: undefined }])[0],
    ...over
  });

  it('groups proposals by group name and kind, de-duplicating category names', () => {
    const plan = pendingCategoryCreations([
      proposalRow({ index: 0, type: 'expense', suggestion: { groupName: 'Food', categoryName: 'Coffee' } }),
      proposalRow({ index: 1, type: 'expense', suggestion: { groupName: 'food', categoryName: 'coffee' } }),
      proposalRow({ index: 2, type: 'expense', suggestion: { groupName: 'Food', categoryName: 'Lunch' } })
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ groupName: 'Food', kind: 'expense' });
    expect(plan[0].categories).toEqual(['Coffee', 'Lunch']);
  });

  it('splits a same-named group across kinds', () => {
    const plan = pendingCategoryCreations([
      proposalRow({ index: 0, type: 'expense', suggestion: { groupName: 'Misc', categoryName: 'Fees' } }),
      proposalRow({ index: 1, type: 'income', suggestion: { groupName: 'Misc', categoryName: 'Refunds' } })
    ]);
    expect(plan).toHaveLength(2);
    expect(plan.map((g) => g.kind).sort()).toEqual(['expense', 'income']);
  });

  it('ignores rows that already have a category or whose suggestion points at an existing one', () => {
    const plan = pendingCategoryCreations([
      proposalRow({ index: 0, categoryId: 'c1', suggestion: { groupName: 'Food', categoryName: 'Coffee' } }),
      proposalRow({ index: 1, type: 'expense', suggestion: { categoryId: 'c9', categoryName: 'Groceries' } })
    ]);
    expect(plan).toEqual([]);
  });

  it('keeps an existing groupId so the caller skips creating that group', () => {
    const plan = pendingCategoryCreations([
      proposalRow({
        index: 0,
        type: 'expense',
        suggestion: { groupId: 'g1', groupName: 'Food', categoryName: 'Coffee' }
      })
    ]);
    expect(plan[0].groupId).toBe('g1');
  });
});

describe('compareRows', () => {
  const [earlier, later] = toImportRows([
    { ...cleanRow, date: '2026-01-01', amount: '5.00' },
    { ...cleanRow, index: 1, date: '2026-01-15', amount: '50.00' }
  ]);

  it('orders by date ascending', () => {
    expect(compareRows(earlier, later, 'date')).toBeLessThan(0);
    expect(compareRows(later, earlier, 'date')).toBeGreaterThan(0);
    expect(compareRows(earlier, earlier, 'date')).toBe(0);
  });

  it('orders by amount ascending, numerically not lexically', () => {
    expect(compareRows(earlier, later, 'amount')).toBeLessThan(0);
    expect(compareRows(later, earlier, 'amount')).toBeGreaterThan(0);
  });

  it('orders by type alphabetically (expense before income)', () => {
    const [expenseRow] = toImportRows([{ ...cleanRow, type: 'expense' }]);
    const [incomeRow] = toImportRows([{ ...cleanRow, type: 'income' }]);
    expect(compareRows(expenseRow, incomeRow, 'type')).toBeLessThan(0);
  });

  it('treats a missing date/amount as sorting first, without throwing', () => {
    const [blank] = toImportRows([{ ...cleanRow, date: undefined, amount: undefined }]);
    expect(compareRows(blank, later, 'date')).toBeLessThan(0);
    expect(compareRows(blank, later, 'amount')).toBeLessThan(0);
  });
});
