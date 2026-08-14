import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Thin wrapper around HttpClient that prefixes every call with the API base
 * path. nginx proxies `/api` to the backend in every environment (dev
 * proxy, docker compose, homelab) - see docker/nginx/default.conf - so this
 * never needs environment-specific base URLs.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1';

  get<T>(path: string, params?: Record<string, string>): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, {
      params: params ? new HttpParams({ fromObject: params }) : undefined
    });
  }
}
