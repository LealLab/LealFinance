import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { ApiError } from './api-error';
import { httpErrorInterceptor } from './http-error.interceptor';
import { SessionService } from './session.service';

describe('httpErrorInterceptor', () => {
  const session = { handleApiError: vi.fn() };

  beforeEach(() => {
    session.handleApiError.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: SessionService, useValue: session }] });
  });

  it('unwraps the backend envelope while preserving HTTP status', () => {
    const response = new HttpErrorResponse({
      status: 422,
      error: { error: { code: 'transaction.invalid_shape', params: { type: 'transfer' } } },
    });
    let received: unknown;
    TestBed.runInInjectionContext(() =>
      httpErrorInterceptor(new HttpRequest('GET', '/api'), () =>
        throwError(() => response),
      ).subscribe({ error: (error) => (received = error) }),
    );
    expect(received).toEqual(new ApiError(422, 'transaction.invalid_shape', { type: 'transfer' }));
    expect(session.handleApiError).toHaveBeenCalledWith(422, 'transaction.invalid_shape');
  });

  it('leaves non-API failures untouched', () => {
    const response = new HttpErrorResponse({ status: 500, error: 'broken' });
    let received: unknown;
    TestBed.runInInjectionContext(() =>
      httpErrorInterceptor(new HttpRequest('GET', '/api'), () =>
        throwError(() => response),
      ).subscribe({ error: (error) => (received = error) }),
    );
    expect(received).toBe(response);
    expect(session.handleApiError).not.toHaveBeenCalled();
  });
});
