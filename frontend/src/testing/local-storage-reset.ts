/**
 * jsdom's localStorage persists across spec files within the same Vitest
 * worker - TestBed resets the DI container between tests, but not browser
 * storage. Services that read/write it directly (e.g. DisplayCurrencyService,
 * BalanceVisibilityService, ThemeService) persist via an `effect()`, which
 * flushes asynchronously - a spec that toggles one and never awaits another
 * change-detection cycle can leave the write pending past its own afterEach.
 * Clearing on both sides closes that gap: beforeEach guarantees a clean slate
 * right before the next spec's services are constructed, regardless of when
 * the previous spec's trailing write actually landed.
 *
 * Registered as a global Vitest setup file - see the `test.options.setupFiles`
 * entry in angular.json - so individual specs don't need to import it.
 */
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());
