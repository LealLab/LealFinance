/**
 * Mirrors the backend's error envelope (app/core/errors.py):
 * { "error": { "code": "account.insufficient_balance", "params": {...} } }
 *
 * The code is a Transloco key suffix, not a translated string - see
 * docs/i18n.md. Callers prefix it with "errors." to get the translation
 * key themselves (not shown as a literal call here, so transloco-keys-manager
 * doesn't mistake this comment for a real usage site).
 */
export interface ApiErrorBody {
  error: {
    code: string;
    params: Record<string, unknown>;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const err = (value as { error: unknown }).error;
  return typeof err === 'object' && err !== null && 'code' in err;
}
