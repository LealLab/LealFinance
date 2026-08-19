import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Account, AccountBalance } from '../../domain/models/account';
import { AccountRepository } from '../account.repository';
import { mapAccount, mapAccountBalance, mapAccountCreate, mapAccountPatch } from './mappers';
import { notFoundOrThrow } from './repository-errors';
import { AccountBalanceWire, AccountWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpAccountRepository extends AccountRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<Account[]> {
    return this.api.get<AccountWire[]>('/accounts').pipe(map((items) => items.map(mapAccount)));
  }
  balances(): Observable<AccountBalance[]> {
    return this.api
      .get<AccountBalanceWire[]>('/accounts/balances')
      .pipe(map((items) => items.map(mapAccountBalance)));
  }
  get(id: string): Observable<Account | undefined> {
    return this.api.get<AccountWire>(`/accounts/${id}`).pipe(
      map(mapAccount),
      catchError((e) => notFoundOrThrow<Account>(e, 'account.not_found')),
    );
  }
  create(input: Omit<Account, 'id'>): Observable<Account> {
    return this.api.post<AccountWire>('/accounts', mapAccountCreate(input)).pipe(map(mapAccount));
  }
  update(id: string, changes: Partial<Omit<Account, 'id'>>): Observable<Account> {
    return this.api
      .patch<AccountWire>(`/accounts/${id}`, mapAccountPatch(changes))
      .pipe(map(mapAccount));
  }
  setArchived(id: string, archived: boolean): Observable<Account> {
    return this.api
      .post<AccountWire>(`/accounts/${id}/archive`, { archived })
      .pipe(map(mapAccount));
  }
}
