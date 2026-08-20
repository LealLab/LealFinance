import { ImportRow } from '../../../data/transaction.repository';

/** Local, editable copy of a server-previewed row - the grid's source of
 * truth until Confirm. `reviewed` and `excluded` are UI-only state the
 * server never sees. */
export interface CsvImportRow extends ImportRow {
  reviewed: boolean;
  excluded: boolean;
}

/** Duplicates default to excluded so re-importing the same file is a no-op
 * unless the user explicitly opts a row back in - see
 * transaction-import.ts's mapping-change flow, which re-derives this. */
export function toImportRows(rows: readonly ImportRow[]): CsvImportRow[] {
  return rows.map((row) => ({ ...row, reviewed: false, excluded: row.duplicate }));
}

/** A row can be marked reviewed only once it parses cleanly and carries a
 * category - the backend requires one on every income/expense transaction
 * (see transaction.category_required in
 * backend/app/services/transactions.py), and import never produces
 * transfers or interest entries. */
export function isReviewable(row: CsvImportRow): boolean {
  return !row.error && !!row.categoryId;
}

/** What Confirm actually imports: reviewed, not excluded, and still
 * reviewable - an edit after ticking "reviewed" (e.g. clearing the
 * category) un-tips it back out until it's fixed again. */
export function isImportable(row: CsvImportRow): boolean {
  return row.reviewed && !row.excluded && isReviewable(row);
}

export function reviewedCount(rows: readonly CsvImportRow[]): number {
  return rows.filter(isImportable).length;
}
