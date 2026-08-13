import { InjectionToken } from '@angular/core';

/**
 * Simulated network latency for every mock repository call. Deliberately
 * nonzero by default: without it, loading/skeleton states never get
 * exercised during development and would be untested the day a real,
 * genuinely-slow HTTP backend arrives. Tests override this to 0 via
 * `{ provide: MOCK_LATENCY_MS, useValue: 0 }` so specs don't pay the delay.
 */
export const MOCK_LATENCY_MS = new InjectionToken<number>('MOCK_LATENCY_MS', {
  providedIn: 'root',
  factory: () => 150
});
