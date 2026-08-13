/**
 * Account types the UI understands. `credit_card` gets debt-oriented
 * treatment throughout (see calc/balances.ts) — its balance displays as an
 * amount owed, not a negative cash balance.
 */
export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card' | 'investment';

/**
 * A holding of money in one currency. Every monetary field on this app's
 * models is a decimal *string* paired with an ISO 4217 currency code — see
 * docs/money-and-currency.md — never a bare number, and never a float.
 *
 * `openingBalance` is the balance before any recorded transaction; the
 * account's current balance is opening balance plus every transaction that
 * touches it (see calc/balances.ts), not a separately stored field — that
 * keeps the two impossible to drift apart.
 */
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: string;
  institution?: string;
  archived: boolean;
  /** credit_card only: the card's credit line. */
  creditLimit?: string;
  /** credit_card only: day of month the statement closes (1-31). */
  closingDay?: number;
  /** credit_card only: day of month payment is due (1-31). */
  dueDay?: number;
}
