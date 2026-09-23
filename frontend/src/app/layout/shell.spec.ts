import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { MetadataService } from '../core/metadata.service';
import { AccountRepository } from '../data/account.repository';
import { BudgetRepository } from '../data/budget.repository';
import { CategoryGroupRepository } from '../data/category-group.repository';
import { CategoryRepository } from '../data/category.repository';
import { MockAccountRepository } from '../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../data/mock/mock-budget.repository';
import { MockCategoryGroupRepository } from '../data/mock/mock-category-group.repository';
import { MockCategoryRepository } from '../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../data/mock/mock-latency';
import { MockTransactionRepository } from '../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../data/transaction.repository';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../testing/transloco';
import { Shell } from './shell';

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches } as MediaQueryList);
}

describe('Shell', () => {
  beforeEach(async () => {
    mockMatchMedia(false);

    await TestBed.configureTestingModule({
      imports: [Shell, provideTestTransloco(['en-US', 'pt-BR'])],
      providers: [
        provideTestTranslocoLocale(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        // Shell mounts <app-command-palette />, which injects the four
        // repositories to build its "live data" groups (see
        // command-palette/command-palette.ts) - it needs real DI tokens
        // even though this spec never opens the palette.
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
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

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar.classList.contains('is-expanded')).toBe(true);
    expect(sidebar.querySelector('a[href="/profile"]')).not.toBeNull();
    expect(sidebar.querySelector('select')).toBeNull();

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar.classList.contains('is-collapsed')).toBe(true);
    expect(sidebar.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it('aligns the sidebar version and shows it beside the mobile title', () => {
    mockMatchMedia(true);
    TestBed.inject(MetadataService).settings.set({
      defaultCurrency: 'BRL',
      defaultLocale: 'pt-BR',
      agentsEnabled: false,
      appVersion: 'v1.2.3',
      emailEnabled: false,
    });

    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    const versions = [...fixture.nativeElement.querySelectorAll('.app-version')].map(
      (node) => (node as HTMLElement).textContent?.trim(),
    );
    expect(versions).toEqual(['v1.2.3', 'v1.2.3']);

    const sidebar = fixture.nativeElement.querySelector('#desktop-sidebar') as HTMLElement;
    const sidebarVersion = sidebar.querySelector('.app-version') as HTMLElement;
    expect(sidebarVersion.classList.contains('text-left')).toBe(true);

    const toggle = sidebar.querySelector(
      'button[aria-controls="desktop-sidebar"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(sidebarVersion.classList.contains('text-center')).toBe(true);
    expect(sidebarVersion?.parentElement?.firstElementChild?.tagName).toBe('BUTTON');
    expect(sidebarVersion?.parentElement?.lastElementChild).toBe(sidebarVersion);

    const headerVersion = fixture.nativeElement.querySelector('header .app-version') as HTMLElement;
    expect(headerVersion.textContent?.trim()).toBe('v1.2.3');
    expect(headerVersion.dir).toBe('ltr');
    expect(headerVersion.previousElementSibling?.classList.contains('truncate')).toBe(true);
    expect(fixture.nativeElement.querySelector('dialog .app-version')).toBeNull();
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
