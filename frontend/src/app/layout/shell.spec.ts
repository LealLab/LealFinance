import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
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

describe('Shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Shell,
        TranslocoTestingModule.forRoot({
          langs: { 'en-US': enUS, 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['en-US', 'pt-BR'], defaultLang: 'en-US' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        // Shell mounts <app-command-palette />, which injects the four
        // repositories to build its "live data" groups (see
        // command-palette/command-palette.ts) — it needs real DI tokens
        // even though this spec never opens the palette.
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository }
      ]
    }).compileComponents();
  });

  it('defaults to English and lists both supported languages', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance['availableLangs']).toContain('en-US');
    expect(fixture.componentInstance['availableLangs']).toContain('pt-BR');
    expect(fixture.componentInstance['activeLang']()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(
      Array.from((fixture.nativeElement.querySelector('select') as HTMLSelectElement).options).map(
        (option) => option.textContent
      )
    ).toEqual(['English', 'Português (Brasil)']);
  });

  it('updates the document language when the active language changes', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    fixture.componentInstance['setLang']('pt-BR');
    fixture.detectChanges();

    expect(fixture.componentInstance['activeLang']()).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('toggles the command palette open on Ctrl+K', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      'app-command-palette dialog'
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
  });
});
