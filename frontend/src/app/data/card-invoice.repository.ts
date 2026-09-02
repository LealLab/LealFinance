import { Observable } from 'rxjs';
import { CardInvoice, CardInvoicePayment } from '../domain/models/card-invoice';
import { Transaction } from '../domain/models/transaction';

/**
 * Abstract class used as the DI token (see app.config.ts). Invoices are
 * read-only (derived on the backend); the only write is paying one, which
 * posts a transfer.
 */
export abstract class CardInvoiceRepository {
  /** Past, current and projected future invoices for one credit-card account. */
  abstract list(accountId: string, months?: { back?: number; ahead?: number }): Observable<CardInvoice[]>;
  /** Settle an invoice - posts a transfer from the card's payment account. */
  abstract pay(
    accountId: string,
    closeDate: string,
    payment: CardInvoicePayment,
  ): Observable<Transaction>;
}
