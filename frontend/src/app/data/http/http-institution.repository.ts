import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Institution } from '../../domain/models/institution';
import { InstitutionDeleteMode, InstitutionRepository } from '../institution.repository';
import { mapInstitution, mapInstitutionCreate, mapInstitutionPatch } from './mappers';
import { notFoundOrThrow } from './repository-errors';
import { InstitutionWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpInstitutionRepository extends InstitutionRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<Institution[]> {
    return this.api
      .get<InstitutionWire[]>('/institutions')
      .pipe(map((items) => items.map(mapInstitution)));
  }
  get(id: string): Observable<Institution | undefined> {
    return this.api.get<InstitutionWire>(`/institutions/${id}`).pipe(
      map(mapInstitution),
      catchError((e) => notFoundOrThrow<Institution>(e, 'institution.not_found')),
    );
  }
  create(input: Omit<Institution, 'id'>): Observable<Institution> {
    return this.api
      .post<InstitutionWire>('/institutions', mapInstitutionCreate(input))
      .pipe(map(mapInstitution));
  }
  update(id: string, changes: Partial<Omit<Institution, 'id'>>): Observable<Institution> {
    return this.api
      .patch<InstitutionWire>(`/institutions/${id}`, mapInstitutionPatch(changes))
      .pipe(map(mapInstitution));
  }
  setArchived(id: string, archived: boolean): Observable<Institution> {
    return this.api
      .post<InstitutionWire>(`/institutions/${id}/archive`, { archived })
      .pipe(map(mapInstitution));
  }
  delete(id: string, mode: InstitutionDeleteMode = 'guard'): Observable<void> {
    return this.api.delete(`/institutions/${id}`, { mode });
  }
}
