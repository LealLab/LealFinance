import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { CardInvoice, CardInvoicePayment } from '../../domain/models/card-invoice';
import { Transaction } from '../../domain/models/transaction';
import { CardInvoiceRepository } from '../card-invoice.repository';
import { mapCardInvoice, mapCardInvoicePayment, mapTransaction } from './mappers';
import { CardInvoiceWire, TransactionWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpCardInvoiceRepository extends CardInvoiceRepository {
  private readonly api = inject(ApiClient);

  list(accountId: string, months?: { back?: number; ahead?: number }): Observable<CardInvoice[]> {
    return this.api
      .get<CardInvoiceWire[]>(`/accounts/${accountId}/invoices`, {
        months_back: months?.back,
        months_ahead: months?.ahead,
      })
      .pipe(map((items) => items.map(mapCardInvoice)));
  }

  pay(
    accountId: string,
    closeDate: string,
    payment: CardInvoicePayment,
  ): Observable<Transaction> {
    return this.api
      .post<TransactionWire>(
        `/accounts/${accountId}/invoices/${closeDate}/pay`,
        mapCardInvoicePayment(payment),
      )
      .pipe(map(mapTransaction));
  }
}
