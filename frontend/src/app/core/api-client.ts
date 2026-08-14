import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type ApiQueryValue = string | number | boolean | readonly (string | number | boolean)[];
export type ApiQueryParams = Record<string, ApiQueryValue | null | undefined>;

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

  get<T>(path: string, params?: ApiQueryParams): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, {
      params: this.toHttpParams(params),
    });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body ?? null);
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(`${this.base}${path}`, body ?? null);
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(`${this.base}${path}`, body ?? null);
  }

  delete<T = void>(path: string, params?: ApiQueryParams): Observable<T> {
    return this.http.delete<T>(`${this.base}${path}`, { params: this.toHttpParams(params) });
  }

  private toHttpParams(params?: ApiQueryParams): HttpParams | undefined {
    if (!params) return undefined;

    let result = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        result = result.append(key, String(item));
      }
    }
    return result;
  }
}
