import { Observable } from 'rxjs';
import { Page } from '../core/api-client';
import { Transaction, TransactionType } from '../domain/models/transaction';

export type TransactionSort = 'date' | 'description' | 'amount';
export type SortOrder = 'asc' | 'desc';

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  /** Category group - resolved server-side to that group's categories. */
  groupId?: string;
  institutionId?: string;
  /** Repeatable - omitted means "every type". */
  types?: readonly TransactionType[];
  dateFrom?: string;
  dateTo?: string;
  /** Case-insensitive substring match on description only, not notes. */
  search?: string;
  /** Inclusive bounds on the raw amount; decimal strings, never floats. */
  amountMin?: string;
  amountMax?: string;
  sort?: TransactionSort;
  order?: SortOrder;
  /** Page size. Omitted means "no paging - return everything". */
  limit?: number;
  /** Rows to skip; only meaningful alongside limit. */
  offset?: number;
}

/** CSV import parsing knobs - see backend/app/schemas/transaction_import.py.
 * `auto` date format tries ISO then dd/mm/yyyy; `auto` decimal separator
 * infers from whichever of `.`/`,` appears last in the value. */
export interface ImportOptions {
  dateFormat: 'auto' | 'iso' | 'dmy' | 'mdy';
  decimalSeparator: 'auto' | '.' | ',';
  invertSign: boolean;
}

export interface ImportPreviewRequest {
  /** Raw CSV text, read client-side via File.text() - no multipart upload. */
  content: string;
  accountId: string;
  /** Target field -> CSV header. Omitted asks the server to guess from headers. */
  mapping?: Record<string, string>;
  options: ImportOptions;
}

/** One parsed CSV row, before it becomes a real transaction. `error` is a
 * translation-key error code (see errors.import.* keys); a row with an
 * error can't be reviewed until the user fixes it in the grid. */
export interface ImportRow {
  index: number;
  date?: string;
  description: string;
  type?: 'income' | 'expense';
  amount?: string;
  categoryId?: string;
  categoryName?: string;
  ruleName?: string;
  notes?: string;
  error?: string;
  duplicate: boolean;
}

export interface ImportPreview {
  /** Every column header the server detected in the file - the source list
   * for the mapping selects, so the frontend never re-parses the CSV
   * itself (delimiter sniffing/BOM handling stay server-side only). */
  headers: readonly string[];
  /** Target field -> CSV header actually used (the server's guess, or the
   * caller-supplied mapping echoed back). */
  mapping: Record<string, string | null>;
  rows: ImportRow[];
}

/** See account.repository.ts for the DI-token pattern this follows. */
export abstract class TransactionRepository {
  abstract list(filters?: TransactionFilters): Observable<Transaction[]>;
  /** Same filters as list(), but returns the page plus the total match
   * count for classical page-number pagination. */
  abstract listPage(filters: TransactionFilters): Observable<Page<Transaction>>;
  abstract get(id: string): Observable<Transaction | undefined>;
  abstract create(input: Omit<Transaction, 'id'>): Observable<Transaction>;
  abstract update(id: string, changes: Partial<Omit<Transaction, 'id'>>): Observable<Transaction>;
  abstract delete(id: string): Observable<void>;
  /** Atomic server-side delete of every listed transaction; one foreign or
   * unknown id fails the whole batch. */
  abstract bulkDelete(ids: readonly string[]): Observable<void>;
  /** Atomic server-side re-category of every listed transaction; rejects
   * transfer/interest rows and category-kind mismatches. */
  abstract bulkCategorize(ids: readonly string[], categoryId: string): Observable<void>;
  abstract importPreview(request: ImportPreviewRequest): Observable<ImportPreview>;
  /** Imports every given row as a real transaction in one request; resolves
   * to the number created. All-or-nothing server-side - see
   * app/services/transactions.py::import_transactions. */
  abstract importCommit(items: readonly Omit<Transaction, 'id'>[]): Observable<number>;
}
