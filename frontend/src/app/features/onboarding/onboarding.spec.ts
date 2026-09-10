import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { SessionService } from '../../core/session.service';
import { AccountRepository } from '../../data/account.repository';
import { Onboarding } from './onboarding';
import { OnboardingProgressService } from './onboarding-progress.service';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

const STORAGE_KEY = 'lealfinance.onboarding.progress.user-1';

describe('Onboarding', () => {
  let accountRepository: { list: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    accountRepository = { list: vi.fn().mockReturnValue(of([])) };
  });

  async function create(progress?: object, accounts: { id: string }[] = []) {
    if (progress) localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    accountRepository.list.mockReturnValue(of(accounts));
    await TestBed.configureTestingModule({
      imports: [Onboarding, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SessionService, useValue: { user: () => ({ id: 'user-1' }) } },
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: AccountRepository, useValue: accountRepository },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(Onboarding);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('advances the current step before navigating to the existing screen', async () => {
    const fixture = await create();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.componentInstance['continue']();

    expect(fixture.componentInstance['step']()).toBe(2);
    expect(navigate).toHaveBeenCalledWith(['/settings'], {
      fragment: 'settings-display-currency',
    });
  });

  it('resumes from stored step 3', async () => {
    const fixture = await create({ step: 3, createdAccountId: 'account-1', dismissed: false }, [
      { id: 'account-1' },
    ]);

    expect(fixture.componentInstance['step']()).toBe(3);
  });

  it('keeps account creation available after canceling and returning', async () => {
    const fixture = await create({ step: 2, createdAccountId: null, dismissed: false });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['continue']();
    expect(navigate).toHaveBeenCalledWith(['/accounts'], { queryParams: { new: '1' } });
    fixture.destroy();

    const resumed = TestBed.createComponent(Onboarding);
    resumed.detectChanges();

    expect(resumed.componentInstance['step']()).toBe(2);
    resumed.componentInstance['continue']();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(['/accounts'], { queryParams: { new: '1' } });
  });

  it('lets users revisit an earlier step and retry an interrupted import', async () => {
    const fixture = await create({ step: 4, createdAccountId: 'account-1', dismissed: false });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const headings = fixture.nativeElement.querySelectorAll(
      'h2 button',
    ) as NodeListOf<HTMLButtonElement>;

    headings[2].click();
    fixture.detectChanges();

    expect(fixture.componentInstance['step']()).toBe(3);
    const activeStep = fixture.nativeElement.querySelector('li[aria-current="step"]');
    activeStep.querySelector('button[appButton]').click();
    expect(navigate).toHaveBeenCalledWith(['/transactions', 'import'], undefined);
  });

  it('dismisses setup and persists the dismissed flag', async () => {
    const fixture = await create();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.componentInstance['dismissSetup']();
    TestBed.tick();

    expect(TestBed.inject(OnboardingProgressService).dismissed()).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/']);
  });

  it('adopts the most recent account and does not prompt for another account', async () => {
    const fixture = await create({ step: 2, createdAccountId: null, dismissed: false }, [
      { id: 'older-account' },
      { id: 'newest-account' },
    ]);
    const progress = TestBed.inject(OnboardingProgressService);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(progress.createdAccountId()).toBe('newest-account');
    expect(progress.step()).toBe(3);

    progress.setStep(4);
    fixture.componentInstance['continue']();

    expect(navigate).toHaveBeenCalledWith(['/reconciliation'], {
      queryParams: { accountId: 'newest-account' },
    });
    expect(navigate).not.toHaveBeenCalledWith(['/accounts'], { queryParams: { new: '1' } });
  });
});
