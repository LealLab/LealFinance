import { Transaction } from '../../domain/models/transaction';
import { isZero, money } from '../../shared/money/money';

/**
 * Sign colour + prefix for a transaction amount, shared by the flat table
 * and the floating bulk bar (and reused for projected rows). A zero amount
 * stays neutral regardless of type.
 */
export function rowToneClass(tx: Pick<Transaction, 'type' | 'amount' | 'currency'>): string {
  if (isZero(money(tx.amount, tx.currency))) return 'text-content-primary';
  if (tx.type === 'transfer') return 'text-accent';
  if (tx.type === 'income') return 'text-positive';
  if (tx.type === 'expense') return 'text-negative';
  return 'text-content-primary';
}

export function rowSign(tx: Pick<Transaction, 'type'>): string {
  if (tx.type === 'income') return '+';
  if (tx.type === 'expense') return '−';
  return '';
}
