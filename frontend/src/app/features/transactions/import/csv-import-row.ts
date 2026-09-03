import { ImportRow } from '../../../data/transaction.repository';

/** An AI categorization result parked on a row until the user accepts it.
 * `categoryId` set -> an existing category to assign; otherwise `groupName` +
 * `categoryName` propose a new category (with `groupId` when the group already
 * exists). Never imported directly - a row still needs a real `categoryId`. */
export interface RowSuggestion {
  categoryId?: string;
  groupId?: string;
  groupName?: string;
  categoryName?: string;
}

/** Local, editable copy of a server-previewed row - the grid's source of
 * truth until Confirm. `reviewed` and `excluded` are UI-only state the
 * server never sees. `suggestion` is an AI proposal awaiting acceptance. */
export interface CsvImportRow extends ImportRow {
  reviewed: boolean;
  excluded: boolean;
  suggestion?: RowSuggestion;
}

/** A group's worth of AI-proposed new categories, ready to create. */
export interface PendingGroupCreation {
  groupId?: string;
  groupName: string;
  kind: 'income' | 'expense';
  categories: string[];
}

/** Collapse every row's "new category" suggestion into a per-group create
 * plan: grouped by existing group id or, failing that, group name + kind;
 * category names de-duplicated case-insensitively. Rows that already carry a
 * `categoryId`, or whose suggestion just points at an existing category, are
 * skipped - they need nothing created. */
export function pendingCategoryCreations(rows: readonly CsvImportRow[]): PendingGroupCreation[] {
  const byGroup = new Map<string, PendingGroupCreation>();
  const seenNames = new Map<string, Set<string>>();
  for (const row of rows) {
    const suggestion = row.suggestion;
    if (row.categoryId || !suggestion || suggestion.categoryId || !suggestion.categoryName) continue;
    if (!suggestion.groupName || !row.type) continue;
    const key = `${row.type} ${suggestion.groupId ?? suggestion.groupName.toLowerCase()}`;
    let entry = byGroup.get(key);
    if (!entry) {
      entry = {
        groupId: suggestion.groupId,
        groupName: suggestion.groupName,
        kind: row.type,
        categories: [],
      };
      byGroup.set(key, entry);
      seenNames.set(key, new Set<string>());
    }
    const seen = seenNames.get(key)!;
    const dedupe = suggestion.categoryName.toLowerCase();
    if (!seen.has(dedupe)) {
      seen.add(dedupe);
      entry.categories.push(suggestion.categoryName);
    }
  }
  return [...byGroup.values()];
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

export type ImportSortColumn = 'date' | 'type' | 'amount';

/** Ascending comparator for the grid's sortable columns - display ordering
 * only (never written anywhere), so a plain numeric compare for `amount`
 * is fine even though money elsewhere in the app always goes through
 * shared/money/money.ts's bigint arithmetic. A missing/unparseable value
 * sorts first rather than throwing, since a row mid-edit can have one. */
export function compareRows(a: CsvImportRow, b: CsvImportRow, column: ImportSortColumn): number {
  if (column === 'date') return (a.date ?? '').localeCompare(b.date ?? '');
  if (column === 'type') return (a.type ?? '').localeCompare(b.type ?? '');
  return (Number(a.amount) || 0) - (Number(b.amount) || 0);
}
