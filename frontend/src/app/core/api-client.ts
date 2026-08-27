import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export type ApiQueryValue = string | number | boolean | readonly (string | number | boolean)[];
export type ApiQueryParams = Record<string, ApiQueryValue | null | undefined>;

/** One page of a list endpoint plus its unpaginated match count. */
export interface Page<T> {
  readonly items: T[];
  readonly total: number;
}

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

  /**
   * GET for a paginated list endpoint: returns the body plus the
   * `X-Total-Count` header the backend sets when a `limit` is supplied.
   * Falls back to the payload length when the header is absent, so a mock
   * or proxy that strips it still yields a coherent page.
   */
  getPage<T>(path: string, params?: ApiQueryParams): Observable<Page<T>> {
    return this.http
      .get<T[]>(`${this.base}${path}`, { params: this.toHttpParams(params), observe: 'response' })
      .pipe(
        map((response) => ({
          items: response.body ?? [],
          total: Number(response.headers.get('X-Total-Count') ?? response.body?.length ?? 0),
        })),
      );
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
