import { defer, Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';

/**
 * Wraps a synchronous mock operation as an Observable with simulated
 * latency, matching the shape (if not the timing characteristics) of a
 * real HTTP call: nothing runs until subscribed (`defer`), and a thrown
 * error becomes an Observable error rather than an uncaught exception.
 *
 * `latencyMs <= 0` skips `delay()` entirely rather than calling it with 0
 * - RxJS's `delay(0)` still schedules onto a macrotask, which a zoneless
 * app's `ComponentFixture.whenStable()` doesn't track (it only sees
 * Angular's own signal/resource machinery, not arbitrary `setTimeout`s),
 * so tests that override MOCK_LATENCY_MS to 0 need this to genuinely
 * resolve synchronously, not just "soon."
 */
export function mockResult<T>(factory: () => T, latencyMs: number): Observable<T> {
  const source = defer(() => {
    try {
      return of(factory());
    } catch (error) {
      return throwError(() => error);
    }
  });
  return latencyMs > 0 ? source.pipe(delay(latencyMs)) : source;
}
