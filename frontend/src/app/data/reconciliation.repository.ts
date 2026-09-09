import { Observable } from 'rxjs';
import { Reconciliation, ReconciliationDetail } from '../domain/models/reconciliation';

export interface ReconciliationCreateInput {
  accountId: string;
  statementDate: string;
  statementBalance: string;
}

export abstract class ReconciliationRepository {
  abstract list(accountId?: string): Observable<Reconciliation[]>;
  abstract create(input: ReconciliationCreateInput): Observable<Reconciliation>;
  abstract detail(id: string): Observable<ReconciliationDetail>;
  abstract setEntries(
    id: string,
    transactionIds: string[],
    cleared: boolean,
  ): Observable<ReconciliationDetail>;
  abstract complete(id: string): Observable<Reconciliation>;
  abstract reopen(id: string): Observable<Reconciliation>;
  abstract remove(id: string): Observable<void>;
}
