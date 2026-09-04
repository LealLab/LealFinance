import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Loan } from '../../domain/models/loan';
import { Transaction } from '../../domain/models/transaction';
import {
  LoanAdvancePayment,
  LoanCreate,
  LoanPayment,
  LoanRepository,
  LoanUpdate,
} from '../loan.repository';
import {
  mapLoan,
  mapLoanAdvancePayment,
  mapLoanCreate,
  mapLoanPatch,
  mapLoanPayment,
  mapTransaction,
} from './mappers';
import { LoanWire, TransactionWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpLoanRepository extends LoanRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<Loan[]> {
    return this.api.get<LoanWire[]>('/loans').pipe(map((items) => items.map(mapLoan)));
  }
  create(input: LoanCreate): Observable<Loan> {
    return this.api.post<LoanWire>('/loans', mapLoanCreate(input)).pipe(map(mapLoan));
  }
  update(id: string, changes: LoanUpdate): Observable<Loan> {
    return this.api.patch<LoanWire>(`/loans/${id}`, mapLoanPatch(changes)).pipe(map(mapLoan));
  }
  setArchived(id: string, archived: boolean): Observable<Loan> {
    return this.api.post<LoanWire>(`/loans/${id}/archive`, { archived }).pipe(map(mapLoan));
  }
  recordPayment(id: string, payment: LoanPayment): Observable<Transaction> {
    return this.api
      .post<TransactionWire>(`/loans/${id}/payments`, mapLoanPayment(payment))
      .pipe(map(mapTransaction));
  }
  advancePayments(id: string, payment: LoanAdvancePayment): Observable<Transaction[]> {
    return this.api
      .post<TransactionWire[]>(`/loans/${id}/advance-payments`, mapLoanAdvancePayment(payment))
      .pipe(map((items) => items.map(mapTransaction)));
  }
}
