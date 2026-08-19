import { Observable } from 'rxjs';
import { Transaction, TransactionType } from '../domain/models/transaction';

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  institutionId?: string;
  /** Repeatable - omitted means "every type". */
  types?: readonly TransactionType[];
  dateFrom?: string;
  dateTo?: string;
  /** Case-insensitive substring match on description only, not notes. */
  search?: string;
  /** Page size. Omitted means "no paging - return everything". */
  limit?: number;
  /** Rows to skip; only meaningful alongside limit. */
  offset?: number;
}

/** See account.repository.ts for the DI-token pattern this follows. */
export abstract class TransactionRepository {
  abstract list(filters?: TransactionFilters): Observable<Transaction[]>;
  abstract get(id: string): Observable<Transaction | undefined>;
  abstract create(input: Omit<Transaction, 'id'>): Observable<Transaction>;
  abstract update(id: string, changes: Partial<Omit<Transaction, 'id'>>): Observable<Transaction>;
  abstract delete(id: string): Observable<void>;
}
