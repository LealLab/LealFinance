import {
  base64urlToBuffer,
  bufferToBase64url,
  isPasskeyCancellation,
} from './webauthn';

describe('WebAuthn helpers', () => {
  it('round-trips base64url values with padding and URL-safe characters', () => {
    for (const value of ['', 'Zg', 'Zm8', 'Zm9v', '-_8']) {
      expect(bufferToBase64url(base64urlToBuffer(value))).toBe(value);
    }
  });

  it('recognizes browser prompt cancellation errors', () => {
    expect(isPasskeyCancellation(new DOMException('dismissed', 'NotAllowedError'))).toBe(true);
    expect(isPasskeyCancellation(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isPasskeyCancellation(new DOMException('failed', 'OperationError'))).toBe(false);
    expect(isPasskeyCancellation(new Error('dismissed'))).toBe(false);
  });
});
