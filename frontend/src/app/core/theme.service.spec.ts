import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

// jsdom doesn't implement window.matchMedia at all, so it must be assigned
// outright rather than spied on (vi.spyOn requires the property to already
// exist as a function).
function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches } as MediaQueryList);
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  function create(): ThemeService {
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  it('defaults to light when there is no stored preference and the OS prefers light', () => {
    const service = create();

    expect(service.current()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('defaults to dark when the OS prefers dark and nothing is stored', () => {
    mockMatchMedia(true);

    const service = create();

    expect(service.current()).toBe('dark');
  });

  it('prefers a stored theme over the OS setting', () => {
    localStorage.setItem('lealfinance.theme', 'dark');
    mockMatchMedia(false);

    const service = create();

    expect(service.current()).toBe('dark');
  });

  it('toggle flips the theme, updates the DOM attribute, and persists it', () => {
    const service = create();

    service.toggle();
    TestBed.tick();

    expect(service.current()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('lealfinance.theme')).toBe('dark');
  });

  it('setTheme sets an explicit value', () => {
    const service = create();

    service.setTheme('dark');
    TestBed.tick();

    expect(service.current()).toBe('dark');
  });
});
