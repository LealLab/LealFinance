import { ApiError } from '../../core/api-error';
import { Observable, of, throwError } from 'rxjs';

export function notFoundOrThrow<T>(error: unknown, code: string): Observable<T | undefined> {
  return error instanceof ApiError && error.code === code ? of(undefined) : throwError(() => error);
}
