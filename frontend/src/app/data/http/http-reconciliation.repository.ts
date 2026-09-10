import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Reconciliation, ReconciliationDetail } from '../../domain/models/reconciliation';
import { ReconciliationCreateInput, ReconciliationRepository } from '../reconciliation.repository';
import {
  mapReconciliation,
  mapReconciliationCreate,
  mapReconciliationDetail,
} from './mappers';
import {
  ReconciliationDetailWire,
  ReconciliationWire,
} from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpReconciliationRepository extends ReconciliationRepository {
  private readonly api = inject(ApiClient);

  list(accountId?: string): Observable<Reconciliation[]> {
    return this.api
      .get<ReconciliationWire[]>('/reconciliations', { account_id: accountId })
      .pipe(map((items) => items.map(mapReconciliation)));
  }

  create(input: ReconciliationCreateInput): Observable<Reconciliation> {
    return this.api
      .post<ReconciliationWire>('/reconciliations', mapReconciliationCreate(input))
      .pipe(map(mapReconciliation));
  }

  detail(id: string): Observable<ReconciliationDetail> {
    return this.api
      .get<ReconciliationDetailWire>(`/reconciliations/${id}`)
      .pipe(map(mapReconciliationDetail));
  }

  setEntries(id: string, transactionIds: string[], cleared: boolean): Observable<ReconciliationDetail> {
    return this.api
      .post<ReconciliationDetailWire>(`/reconciliations/${id}/entries`, {
        transaction_ids: transactionIds,
        cleared,
      })
      .pipe(map(mapReconciliationDetail));
  }

  complete(id: string): Observable<Reconciliation> {
    return this.api
      .post<ReconciliationWire>(`/reconciliations/${id}/complete`)
      .pipe(map(mapReconciliation));
  }

  reopen(id: string): Observable<Reconciliation> {
    return this.api
      .post<ReconciliationWire>(`/reconciliations/${id}/reopen`)
      .pipe(map(mapReconciliation));
  }

  remove(id: string): Observable<void> {
    return this.api.delete(`/reconciliations/${id}`);
  }
}
