/**
 * The toggleable columns of the transactions table. The checkbox and the
 * row-actions cells are structural, not user-hideable, so they are not in
 * this union.
 */
export type TransactionColumn = 'date' | 'description' | 'category' | 'account' | 'amount';

export const ALL_COLUMNS: readonly TransactionColumn[] = [
  'date',
  'description',
  'category',
  'account',
  'amount',
];

export const DEFAULT_COLUMNS: readonly TransactionColumn[] = ALL_COLUMNS;

export const MIN_COLUMN_WIDTH = 96;
/** Sum kept modest so the default table doesn't force a horizontal
 * scrollbar on a laptop with the sidebar open; the grid still scrolls
 * inside its `overflow-x-auto` wrapper once a user widens columns. */
export const DEFAULT_WIDTHS: Record<TransactionColumn, number> = {
  date: 116,
  description: 260,
  category: 144,
  account: 152,
  amount: 124,
};

export function isTransactionColumn(value: unknown): value is TransactionColumn {
  return typeof value === 'string' && (ALL_COLUMNS as readonly string[]).includes(value);
}
