import { ImportRow } from '../../../data/transaction.repository';
import { isImportable, isReviewable, reviewedCount, toImportRows } from './csv-import-row';

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
