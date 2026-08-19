/**
 * jsdom (as used by the Vitest-based unit-test builder) does not implement
 * `IntersectionObserver` - see https://github.com/jsdom/jsdom/issues/2032.
 * shared/ui/infinite-scroll/infinite-scroll.ts is built on it, so without
 * this polyfill any spec that renders a paginated list (transactions,
 * account-detail) fails with "IntersectionObserver is not defined" rather
 * than testing real component behavior.
 *
 * This stub never actually fires - it's just enough for `new
 * IntersectionObserver(...)` and `.observe()`/`.disconnect()` to not throw.
 * Specs that need to simulate an intersection (infinite-scroll.spec.ts)
 * install their own mock via `vi.stubGlobal`, which takes priority over this
 * one for the duration of that test file.
 *
 * Registered as a global Vitest setup file - see the `test.options.setupFiles`
 * entry in angular.json - so individual specs don't need to import it.
 */
class NoopIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {
    // no-op - see the class docstring.
  }
  unobserve(): void {
    // no-op - see the class docstring.
  }
  disconnect(): void {
    // no-op - see the class docstring.
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = NoopIntersectionObserver;
}

export {};
