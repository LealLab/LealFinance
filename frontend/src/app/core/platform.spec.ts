import { isMacPlatform } from './platform';

describe('isMacPlatform', () => {
  const originalPlatform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns true when navigator.platform reports a Mac', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });

    expect(isMacPlatform()).toBe(true);
  });

  it('returns false when navigator.platform reports Windows', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });

    expect(isMacPlatform()).toBe(false);
  });
});
