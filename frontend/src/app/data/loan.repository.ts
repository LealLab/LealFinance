import { Observable } from 'rxjs';
import { Loan } from '../domain/models/loan';
import { Transaction } from '../domain/models/transaction';

/** `installmentAmount` and `installmentsPaid` are resolved by the backend, never sent. */
export type LoanCreate = Omit<Loan, 'id' | 'installmentAmount' | 'installmentsPaid'>;
export type LoanUpdate = Partial<
  Omit<Loan, 'id' | 'installmentAmount' | 'installmentsPaid' | 'archived'>
>;

/** All fields optional: the backend fills `amount` from the loan's installment,
 * `date` from today, and `accountId` from the loan's payment account. */
export interface LoanPayment {
  amount?: string;
  date?: string;
  accountId?: string;
  description?: string;
}

export interface LoanAdvancePayment extends LoanPayment {
  mode: 'last' | 'all';
  count?: number;
}

export abstract class LoanRepository {
  abstract list(): Observable<Loan[]>;
  abstract create(input: LoanCreate): Observable<Loan>;
  abstract update(id: string, changes: LoanUpdate): Observable<Loan>;
  abstract setArchived(id: string, archived: boolean): Observable<Loan>;
  /** Records one installment as an expense transaction linked to the loan. */
  abstract recordPayment(id: string, payment: LoanPayment): Observable<Transaction>;
  /** Records the last N or every open installment atomically. */
  abstract advancePayments(id: string, payment: LoanAdvancePayment): Observable<Transaction[]>;
}
