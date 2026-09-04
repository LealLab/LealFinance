import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Loan } from '../../domain/models/loan';
import { Transaction } from '../../domain/models/transaction';
import {
  LoanAdvancePayment,
  LoanCreate,
  LoanPayment,
  LoanRepository,
  LoanUpdate,
} from '../loan.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockLoanRepository extends LoanRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Loan[]> {
    return mockResult(() => this.store.listLoans(), this.latencyMs);
  }

  create(input: LoanCreate): Observable<Loan> {
    return mockResult(() => this.store.createLoan(input), this.latencyMs);
  }

  update(id: string, changes: LoanUpdate): Observable<Loan> {
    return mockResult(() => this.store.updateLoan(id, changes), this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<Loan> {
    return mockResult(() => this.store.updateLoan(id, { archived }), this.latencyMs);
  }

  recordPayment(id: string, payment: LoanPayment): Observable<Transaction> {
    return mockResult(() => this.store.recordLoanPayment(id, payment), this.latencyMs);
  }

  advancePayments(id: string, payment: LoanAdvancePayment): Observable<Transaction[]> {
    return mockResult(() => this.store.advanceLoanPayments(id, payment), this.latencyMs);
  }
}
