/**
 * One billing cycle ("fatura") of a `credit_card` account. Entirely
 * derived on the backend from the card's `closingDay`/`dueDay` and its
 * ledger - see app/services/card_invoices.py. There is deliberately no
 * cycle math on the frontend: this is the one source of truth, the
 * frontend only renders what it returns.
 *
 * Money fields are decimal strings in the card's own currency, like every
 * other monetary value in the app.
 */
export type CardInvoiceStatus = 'open' | 'closed' | 'overdue' | 'paid' | 'projected';

export interface CardInvoice {
  /** Identifies the cycle - the date its statement closed (or will close). */
  closeDate: string;
  /** First `dueDay` strictly after `closeDate`; when the bill must be paid. */
  dueDate: string;
  /** Inclusive date range of charges in this cycle: (period_start .. period_end). */
  periodStart: string;
  periodEnd: string;
  currency: string;
  /** What the cycle's charges add up to - positive means owed. */
  total: string;
  /** Sum of payments settled against this cycle. */
  paid: string;
  /** `total - paid`; what is still owed. */
  remaining: string;
  status: CardInvoiceStatus;
}

/**
 * Body for paying an invoice. Every field optional: source defaults to the
 * card's `paymentAccountId`, date to today, amount to `remaining`.
 */
export interface CardInvoicePayment {
  accountId?: string;
  date?: string;
  amount?: string;
  description?: string;
}
