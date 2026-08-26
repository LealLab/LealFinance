import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { AccountRepository } from '../data/account.repository';
import { BudgetRepository } from '../data/budget.repository';
import { CategoryRepository } from '../data/category.repository';
import { MockAccountRepository } from '../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../data/mock/mock-latency';
import { MockTransactionRepository } from '../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../data/transaction.repository';
import { Shell } from './shell';
import enUS from '../../../public/i18n/en-US.json';
import ptBR from '../../../public/i18n/pt-BR.json';

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches } as MediaQueryList);
}

describe('Shell', () => {
  beforeEach(async () => {
    mockMatchMedia(false);

    await TestBed.configureTestingModule({
      imports: [
        Shell,
        TranslocoTestingModule.forRoot({
          langs: { 'en-US': enUS, 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['en-US', 'pt-BR'], defaultLang: 'en-US' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        // Shell mounts <app-command-palette />, which injects the four
        // repositories to build its "live data" groups (see
        // command-palette/command-palette.ts) - it needs real DI tokens
        // even though this spec never opens the palette.
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
      ],
    }).compileComponents();
  });

  it('defaults to English and lists both supported languages', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    const transloco = TestBed.inject(TranslocoService);
    expect(transloco.getAvailableLangs()).toEqual(expect.arrayContaining(['en-US', 'pt-BR']));
    expect(transloco.getActiveLang()).toBe('en-US');
    expect(
      Array.from((fixture.nativeElement.querySelector('select') as HTMLSelectElement).options).map(
        (option) => option.textContent,
      ),
    ).toEqual(['English', 'Português (Brasil)']);
  });

  it('updates the active language when the language select changes', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'pt-BR';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('pt-BR');
  });

  it('keeps a persisted language selected when options are rendered', () => {
    const transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('pt-BR');

    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('select') as HTMLSelectElement).value).toBe(
      'pt-BR',
    );
  });

  it('follows the desktop breakpoint and toggles the sidebar for the session', () => {
    mockMatchMedia(true);

    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('#desktop-sidebar') as HTMLElement;
    const toggle = sidebar.querySelector(
      'button[aria-controls="desktop-sidebar"]',
    ) as HTMLButtonElement;
    const languageSelect = sidebar.querySelector('select') as HTMLSelectElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar.classList.contains('is-expanded')).toBe(true);
    expect(sidebar.querySelector('app-icon[name="globe"]')).not.toBeNull();
    expect(languageSelect.classList.contains('w-full')).toBe(true);
    expect(languageSelect.classList.contains('bg-surface-raised')).toBe(true);
    expect(languageSelect.classList.contains('text-content-muted')).toBe(true);

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar.classList.contains('is-collapsed')).toBe(true);
    expect(sidebar.querySelector('app-icon[name="globe"]')).toBeNull();
    expect(languageSelect.classList.contains('w-8')).toBe(true);
    expect(languageSelect.classList.contains('bg-surface-raised')).toBe(true);
    expect(languageSelect.classList.contains('text-content-muted')).toBe(true);
    expect(languageSelect.classList.contains('opacity-0')).toBe(true);
    expect(languageSelect.classList.contains('text-transparent')).toBe(false);
  });

  it('toggles the command palette open on Ctrl+K', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      'app-command-palette dialog',
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
  });
});
