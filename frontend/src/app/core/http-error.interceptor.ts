import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { isApiErrorBody } from './api-error';

/**
 * Normalizes failed API responses so callers always deal with the same
 * shape. Never translates anything here - see docs/i18n.md: translation
 * only happens in components, from the error `code` this interceptor
 * surfaces untouched.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((response: unknown) => {
      if (response instanceof HttpErrorResponse && isApiErrorBody(response.error)) {
        return throwError(() => response.error);
      }
      return throwError(() => response);
    })
  );
};
