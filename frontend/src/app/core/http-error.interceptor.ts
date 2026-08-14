import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { ApiError, isApiErrorBody } from './api-error';
import { SessionService } from './session.service';

/**
 * Normalizes failed API responses so callers always deal with the same
 * shape. Never translates anything here - see docs/i18n.md: translation
 * only happens in components, from the error `code` this interceptor
 * surfaces untouched.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  return next(req).pipe(
    catchError((response: unknown) => {
      if (response instanceof HttpErrorResponse && isApiErrorBody(response.error)) {
        const { code, params } = response.error.error;
        const error = new ApiError(response.status, code, params ?? {});
        session.handleApiError(error.status, error.code);
        return throwError(() => error);
      }
      return throwError(() => response);
    }),
  );
};
