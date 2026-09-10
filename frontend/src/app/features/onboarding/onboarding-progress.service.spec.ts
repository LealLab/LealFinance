import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OnboardingProgressService } from './onboarding-progress.service';

const STORAGE_KEY = 'lealfinance.onboarding.progress';

describe('OnboardingProgressService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => vi.restoreAllMocks());

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
