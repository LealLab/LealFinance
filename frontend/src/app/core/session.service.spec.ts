import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, of } from 'rxjs';
import { IdentityApiService } from './identity-api.service';
import { MetadataService } from './metadata.service';
import { Preferences } from './identity.models';
import { SessionService } from './session.service';
import { ThemeService } from './theme.service';

const SERVER_PREFERENCES: Preferences = {
  locale: 'en-US',
  theme: 'light',
  baseCurrency: 'USD',
  displayCurrency: 'USD',
  balancesHidden: false,
  investmentsEnabled: false,
};

describe('SessionService', () => {
  let api: {
    register: ReturnType<typeof vi.fn>;
    getPreferences: ReturnType<typeof vi.fn>;
    updatePreferences: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    api = {
      register: vi.fn().mockReturnValue(
        of({
          id: 'u1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          role: 'admin',
          isActive: true,
          aiChatEnabled: false,
          createdAt: '2026-08-31T00:00:00Z',
        }),
      ),
      getPreferences: vi.fn().mockReturnValue(of(SERVER_PREFERENCES)),
      updatePreferences: vi.fn().mockReturnValue(of({ ...SERVER_PREFERENCES, theme: 'dark' })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: IdentityApiService, useValue: api },
        {
          provide: MetadataService,
          useValue: { hydrate: vi.fn().mockReturnValue(of(undefined)) },
        },
        { provide: TranslocoService, useValue: { setActiveLang: vi.fn() } },
      ],
    });
  });

  it('persists the current dark theme when registering a new account', async () => {
    const session = TestBed.inject(SessionService);
    const theme = TestBed.inject(ThemeService);

    await firstValueFrom(
      session.register({
        email: 'ada@example.com',
        password: 'a-very-long-password',
        displayName: 'Ada Lovelace',
        baseCurrency: 'USD',
        locale: 'en-US',
      }),
    );
    TestBed.tick();

    expect(theme.current()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(api.updatePreferences).toHaveBeenCalledWith({ theme: 'dark' });
  });
});
