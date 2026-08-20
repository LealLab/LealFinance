/**
 * jsdom's localStorage persists across spec files within the same Vitest
 * worker - TestBed resets the DI container between tests, but not browser
 * storage. Services that read/write it directly (e.g. DisplayCurrencyService,
 * ThemeService) would otherwise leak state into whichever spec happens to
 * run next, making test outcomes depend on run order.
 *
 * Registered as a global Vitest setup file - see the `test.options.setupFiles`
 * entry in angular.json - so individual specs don't need to import it.
 */
afterEach(() => localStorage.clear());
