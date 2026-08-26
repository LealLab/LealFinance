import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { IdentityApiService } from './identity-api.service';
import { Preferences } from './identity.models';
import { PreferenceService } from './preference.service';
import { ThemeService } from './theme.service';

// jsdom doesn't implement window.matchMedia at all - ThemeService (a real
// dependency here, not stubbed) needs it to compute its initial value.
function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches } as MediaQueryList);
}

const SERVER_PREFERENCES: Preferences = {
  locale: 'en-US',
  theme: 'light',
  baseCurrency: 'USD',
  displayCurrency: 'USD',
  balancesHidden: false,
  investmentsEnabled: false,
};

describe('PreferenceService', () => {
  let api: { getPreferences: ReturnType<typeof vi.fn>; updatePreferences: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    api = {
      getPreferences: vi.fn().mockReturnValue(of(SERVER_PREFERENCES)),
      updatePreferences: vi.fn((changes: Partial<Preferences>) =>
        of({ ...SERVER_PREFERENCES, ...changes }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: IdentityApiService, useValue: api },
        { provide: TranslocoService, useValue: { setActiveLang: vi.fn() } },
      ],
    });
  });

  it('keeps an explicit pre-login theme pick after hydrate and pushes it to the account', () => {
    const preferences = TestBed.inject(PreferenceService);
    const theme = TestBed.inject(ThemeService);

    preferences.setTheme('dark');
    expect(theme.current()).toBe('dark');

    preferences.hydrate().subscribe();

    expect(theme.current()).toBe('dark');
    expect(api.updatePreferences).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('lets the account theme win when nothing was picked before login', () => {
    const preferences = TestBed.inject(PreferenceService);
    const theme = TestBed.inject(ThemeService);

    preferences.hydrate().subscribe();

    expect(theme.current()).toBe('light');
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it('clear() drops a pending pre-login pick', () => {
    const preferences = TestBed.inject(PreferenceService);
    const theme = TestBed.inject(ThemeService);

    preferences.setTheme('dark');
    preferences.clear();
    preferences.hydrate().subscribe();

    expect(theme.current()).toBe('light');
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });
});
