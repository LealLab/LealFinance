import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionService } from '../../core/session.service';
import { OnboardingProgressService } from './onboarding-progress.service';

const STORAGE_KEY = 'lealfinance.onboarding.progress.user-1';

describe('OnboardingProgressService', () => {
  const user = signal<{ id: string } | undefined>(undefined);
  beforeEach(() => {
    localStorage.clear();
    user.set({ id: 'user-1' });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SessionService, useValue: { user } },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('isolates users across logout and login and restores their own progress', () => {
    const progress = TestBed.inject(OnboardingProgressService);
    progress.setStep(4);
    progress.setCreatedAccountId('account-1');
    progress.dismiss();
    TestBed.tick();

    user.set(undefined);
    expect(progress.progress()).toEqual({ step: 1, createdAccountId: null, dismissed: false });
    TestBed.tick();
    user.set({ id: 'user-2' });
    expect(progress.progress()).toEqual({ step: 1, createdAccountId: null, dismissed: false });
    progress.setStep(2);
    TestBed.tick();

    user.set({ id: 'user-1' });
    expect(progress.progress()).toEqual({
      step: 4,
      createdAccountId: 'account-1',
      dismissed: true,
    });
    TestBed.tick();
    user.set({ id: 'user-2' });
    expect(progress.step()).toBe(2);
  });

  it('ignores legacy progress whose owner is unknown', () => {
    localStorage.setItem(
      'lealfinance.onboarding.progress',
      JSON.stringify({
        step: 4,
        createdAccountId: 'other-account',
        dismissed: true,
      }),
    );
    expect(TestBed.inject(OnboardingProgressService).progress()).toEqual({
      step: 1,
      createdAccountId: null,
      dismissed: false,
    });
  });

  it('reads the stored progress and persists updates', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ step: 3, createdAccountId: 'account-1', dismissed: false }),
    );
    const progress = TestBed.inject(OnboardingProgressService);

    expect(progress.progress()).toEqual({
      step: 3,
      createdAccountId: 'account-1',
      dismissed: false,
    });

    progress.setStep(4);
    progress.dismiss();
    TestBed.tick();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      step: 4,
      createdAccountId: 'account-1',
      dismissed: true,
    });
  });

  it('falls back cleanly when the stored value is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');

    expect(TestBed.inject(OnboardingProgressService).progress()).toEqual({
      step: 1,
      createdAccountId: null,
      dismissed: false,
    });
  });

  it('tolerates storage throwing while reading and writing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const progress = TestBed.inject(OnboardingProgressService);
    progress.setStep(2);
    TestBed.tick();

    expect(progress.step()).toBe(2);
  });
});
