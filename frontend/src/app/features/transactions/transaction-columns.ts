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

export function isTransactionColumn(value: unknown): value is TransactionColumn {
  return typeof value === 'string' && (ALL_COLUMNS as readonly string[]).includes(value);
}
