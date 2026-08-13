import { Observable } from 'rxjs';
import { Transaction } from '../domain/models/transaction';

/** See account.repository.ts for the DI-token pattern this follows. */
export abstract class TransactionRepository {
  abstract list(): Observable<Transaction[]>;
  abstract get(id: string): Observable<Transaction | undefined>;
  abstract create(input: Omit<Transaction, 'id'>): Observable<Transaction>;
  abstract update(id: string, changes: Partial<Omit<Transaction, 'id'>>): Observable<Transaction>;
  abstract delete(id: string): Observable<void>;
}
