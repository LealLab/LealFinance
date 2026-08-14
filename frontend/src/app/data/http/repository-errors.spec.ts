import { ApiError } from '../../core/api-error';
import { notFoundOrThrow } from './repository-errors';

describe('notFoundOrThrow', () => {
  it('maps only an exact resource not-found code to undefined', () => {
    let result = 'unset';
    notFoundOrThrow(new ApiError(404, 'account.not_found', {}), 'account.not_found').subscribe(
      (value) => (result = String(value)),
    );
    expect(result).toBe('undefined');
  });

  it('propagates every non-matching error unchanged', () => {
    const error = new ApiError(404, 'institution.not_found', {});
    let received: unknown;
    notFoundOrThrow(error, 'account.not_found').subscribe({ error: (value) => (received = value) });
    expect(received).toBe(error);
  });
});
